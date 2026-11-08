/**
 * Epoch assembly (PRD 10.1): window math, the pure per-epoch computation (metrics, flags,
 * scores, merkle tree), and the canonical published document.
 *
 * The published document is served by the API mirror. Its keccak256 over canonical JSON is
 * carried in the onchain dataURI fragment (`#keccak256=0x...`), so anyone can fetch the JSON,
 * recompute the hash, and compare it with what the attestor committed (see docs/SCORING.md).
 */
import { keccak256, toBytes, type Hex } from "viem";
import { ScoreFlag, buildTree, encodeLeaf, toLeafInput, type EpochMetrics, type EpochScore, type NetworkName, type Provenance } from "@strata/sdk";
import { checkCoverage, detectAbuse, flagNames, type FlagEvidence } from "./antiGaming.js";
import { aggregateAgentMetrics, computeMarketMetrics, type AgentMetrics, type MarketMetrics } from "./metrics.js";
import type { AgentRecord, BookSample, EpochWindow, FillRecord, FundingEdge, FundingRecord, MarkPoint, MarketParams, OrderRecord } from "./model.js";
import type { ScoringParams } from "./params.js";
import { computePnl } from "./pnl.js";
import { scoreAgents, type ScoredAgent } from "./score.js";

export interface SeasonInfo {
  season: number;
  startMs: number;
  endMs: number;
  epochSeconds: number;
  active: boolean;
}

export function epochCount(s: SeasonInfo): number {
  return Math.ceil((s.endMs - s.startMs) / (s.epochSeconds * 1_000));
}

export function epochWindow(s: SeasonInfo, epoch: number): EpochWindow {
  if (!Number.isInteger(epoch) || epoch < 0 || epoch >= epochCount(s)) {
    throw new Error(`epoch ${epoch} is outside season ${s.season} (0..${epochCount(s) - 1})`);
  }
  const len = s.epochSeconds * 1_000;
  const startMs = s.startMs + epoch * len;
  return { season: s.season, epoch, startMs, endMs: Math.min(startMs + len, s.endMs) };
}

/** Newest epoch whose end plus the settle delay is not in the future; null when none has closed. */
export function lastClosedEpoch(s: SeasonInfo, nowMs: number, settleDelayMs: number): number | null {
  const count = epochCount(s);
  if (count === 0) return null;
  const len = s.epochSeconds * 1_000;
  const byTime = Math.floor((nowMs - settleDelayMs - s.startMs) / len) - 1;
  let e = Math.min(byTime, count - 1);
  // The truncated final epoch can close before a full epoch length has passed.
  if (e + 1 === count - 1 && epochWindow(s, count - 1).endMs + settleDelayMs <= nowMs) e = count - 1;
  return e >= 0 ? e : null;
}

/** Everything the computation reads for one epoch, already loaded from the database. */
export interface EpochData {
  network: NetworkName;
  window: EpochWindow;
  agents: readonly AgentRecord[];
  /** Arena-enabled markets with their uptime spread limit. */
  markets: readonly MarketParams[];
  /** Book per market, sorted by `at`, from just before the window to the window end plus the markout horizon. */
  book: ReadonlyMap<string, readonly BookSample[]>;
  baselineSpreadBps: ReadonlyMap<string, number>;
  /** Agents' orders that were resting at some point in the window or were posted in it. */
  orders: readonly OrderRecord[];
  /** Agents' fills from the season start to the window end. */
  fills: readonly FillRecord[];
  funding: readonly FundingRecord[];
  /** Mid marks per market from the season start to the window end, for PnL and drawdown. */
  marks: ReadonlyMap<string, readonly MarkPoint[]>;
  fundingEdges: readonly FundingEdge[];
}

export interface AgentBreakdown {
  agentId: number;
  markets: MarketMetrics[];
  metrics: AgentMetrics;
  scored: ScoredAgent;
}

export type EpochComputation =
  | { kind: "skip"; reason: string }
  | { kind: "scored"; merkleRoot: Hex; scores: EpochScore[]; evidence: FlagEvidence[]; breakdown: AgentBreakdown[] };

const SCORABLE_STATUSES = new Set(["active", "halted", "suspended"]);

export function provenanceFor(network: NetworkName): Provenance {
  return network === "mainnet" ? "LIVE" : "TESTNET";
}

export function computeEpoch(data: EpochData, params: ScoringParams): EpochComputation {
  const { window } = data;
  const marketById = new Map(data.markets.map((m) => [m.marketId.toLowerCase(), m]));
  const agentMarkets = (a: AgentRecord) => a.marketIds.map((id) => marketById.get(id.toLowerCase())).filter((m): m is MarketParams => m !== undefined);

  const agents = data.agents
    .filter((a) => SCORABLE_STATUSES.has(a.status) && !a.simulated && a.enrolledAt < window.endMs && agentMarkets(a).length > 0)
    .slice()
    .sort((a, b) => a.agentId - b.agentId);
  if (agents.length === 0) return { kind: "skip", reason: "no eligible agents: none enrolled before the epoch ended with an arena market" };

  const inWindow = (t: number) => t >= window.startMs && t < window.endMs;
  const abuse = detectAbuse({
    agents,
    fills: data.fills.filter((f) => inWindow(f.executedAt)),
    orders: data.orders.filter((o) => inWindow(o.postedAt)),
    fundingEdges: data.fundingEdges,
    params: params.antiGaming,
  });

  const breakdownBase = agents.map((a) => {
    const markets = agentMarkets(a).map((m) =>
      computeMarketMetrics({
        window,
        market: m,
        book: data.book.get(m.marketId) ?? data.book.get(m.marketId.toLowerCase()) ?? [],
        orders: data.orders.filter((o) => o.agentId === a.agentId && o.marketId.toLowerCase() === m.marketId.toLowerCase()),
        fills: data.fills.filter((f) => f.agentId === a.agentId && f.marketId.toLowerCase() === m.marketId.toLowerCase()),
        excludedFillIds: abuse.excludedFillIds,
        baselineSpreadBps: data.baselineSpreadBps.get(m.marketId) ?? null,
      }),
    );
    const pnl = computePnl({
      fills: data.fills.filter((f) => f.agentId === a.agentId),
      funding: data.funding.filter((f) => f.agentId === a.agentId),
      marks: data.marks,
      untilMs: window.endMs - 1,
    });
    return { agent: a, markets, metrics: aggregateAgentMetrics(markets, pnl) };
  });

  if (breakdownBase.every((b) => b.metrics.samples === 0)) {
    return { kind: "skip", reason: "no book data for any arena market in the epoch window" };
  }
  // When no agent has enough samples the gap is ours, not theirs: attesting all-zero scores would misrepresent the epoch.
  const bestCoverage = Math.max(...breakdownBase.map((b) => b.metrics.coverage));
  if (bestCoverage < params.antiGaming.minCoverage) {
    return {
      kind: "skip",
      reason: `book data too sparse: best agent coverage ${(bestCoverage * 100).toFixed(1)}%, minimum ${params.antiGaming.minCoverage * 100}%`,
    };
  }

  const evidence = [...abuse.evidence];
  const entries = breakdownBase.map((b) => {
    let flags = abuse.flags.get(b.agent.agentId) ?? 0;
    const gap = checkCoverage(b.agent.agentId, b.metrics.coverage, params.antiGaming);
    if (gap) {
      evidence.push(gap);
      flags |= ScoreFlag.DATA_GAP;
    }
    return { agentId: b.agent.agentId, flags, metrics: b.metrics };
  });
  const scored = scoreAgents(entries, params.score);

  const network = data.network;
  const provenance = provenanceFor(network);
  const leaves = scored.map((s, i) =>
    encodeLeaf(
      toLeafInput({
        season: window.season,
        epoch: window.epoch,
        agentId: s.agentId,
        score: s.score,
        quotedSpreadBps: entries[i]!.metrics.quotedSpreadBps,
        depthUsd25: entries[i]!.metrics.depthUsd25,
        uptimeBps: entries[i]!.metrics.uptimeBps,
        pnlUsd: entries[i]!.metrics.pnlUsd,
        flags: s.flags,
      }),
    ),
  );
  const tree = buildTree(leaves);
  const scores: EpochScore[] = scored.map((s, i) => ({
    network,
    provenance,
    season: window.season,
    epoch: window.epoch,
    agentId: s.agentId,
    score: s.score,
    metrics: publishedMetrics(entries[i]!.metrics),
    flags: s.flags,
    flagNames: flagNames(s.flags),
    leaf: leaves[i]!,
    proof: tree.proofs[i]!,
  }));
  evidence.sort((a, b) => a.agentId - b.agentId || a.flag.localeCompare(b.flag));
  return {
    kind: "scored",
    merkleRoot: tree.root,
    scores,
    evidence,
    breakdown: breakdownBase.map((b, i) => ({ agentId: b.agent.agentId, markets: b.markets, metrics: b.metrics, scored: scored[i]! })),
  };
}

/** Exactly the EpochMetrics fields from @strata/sdk, nothing scorer-internal. */
export function publishedMetrics(m: AgentMetrics): EpochMetrics {
  return {
    quotedSpreadBps: m.quotedSpreadBps,
    depthUsd25: m.depthUsd25,
    uptimeBps: m.uptimeBps,
    bookShare: m.bookShare,
    markout60s: m.markout60s,
    pnlUsd: m.pnlUsd,
    maxDrawdownUsd: m.maxDrawdownUsd,
    spreadImprovementBps: m.spreadImprovementBps,
    samples: m.samples,
  };
}

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

/** JSON with object keys sorted at every level and no whitespace. Throws on anything JSON cannot hold exactly. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(v: unknown): Json {
  if (v === null || typeof v === "boolean" || typeof v === "string") return v;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error(`canonicalJson: non-finite number ${v}`);
    return v;
  }
  if (Array.isArray(v)) return v.map(canonicalize);
  if (typeof v === "object") {
    const out: { [k: string]: Json } = {};
    for (const k of Object.keys(v).sort()) {
      const child = (v as Record<string, unknown>)[k];
      if (child === undefined) throw new Error(`canonicalJson: undefined at key ${k}`);
      out[k] = canonicalize(child);
    }
    return out;
  }
  throw new Error(`canonicalJson: unsupported ${typeof v}`);
}

export const EPOCH_DOCUMENT_VERSION = 1;

export interface EpochDocumentInput {
  network: NetworkName;
  season: number;
  epoch: number;
  startTime: number;
  endTime: number;
  merkleRoot: string;
  contract: string;
  scores: readonly EpochScore[];
}

/**
 * The document whose hash goes onchain. Built only from fields the public API returns
 * (attestation minus dataURI, txHash and postedAt, which are not known when hashing), so a
 * verifier can rebuild it from GET /v1/epochs/:season/:epoch.
 */
export function canonicalEpochDocument(input: EpochDocumentInput) {
  return {
    version: EPOCH_DOCUMENT_VERSION,
    network: input.network,
    season: input.season,
    epoch: input.epoch,
    startTime: input.startTime,
    endTime: input.endTime,
    merkleRoot: input.merkleRoot.toLowerCase(),
    contract: input.contract.toLowerCase(),
    scores: [...input.scores]
      .sort((a, b) => a.agentId - b.agentId)
      .map((s) => ({
        network: s.network,
        provenance: s.provenance,
        season: s.season,
        epoch: s.epoch,
        agentId: s.agentId,
        score: s.score,
        metrics: s.metrics,
        flags: s.flags,
        flagNames: s.flagNames,
        leaf: s.leaf.toLowerCase(),
        proof: s.proof.map((p) => p.toLowerCase()),
      })),
  };
}

export function documentHash(input: EpochDocumentInput): Hex {
  return keccak256(toBytes(canonicalJson(canonicalEpochDocument(input))));
}

export function buildDataUri(apiBase: string, network: NetworkName, season: number, epoch: number, contentHash: Hex): string {
  const base = apiBase.replace(/\/+$/, "");
  return `${base}/v1/epochs/${season}/${epoch}?network=${network}#keccak256=${contentHash}`;
}

export function parseDataUri(uri: string): { url: string; contentHash: Hex } | null {
  const m = /^(.*)#keccak256=(0x[0-9a-fA-F]{64})$/.exec(uri);
  return m ? { url: m[1]!, contentHash: m[2]! as Hex } : null;
}
