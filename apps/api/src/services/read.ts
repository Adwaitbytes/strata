/**
 * Read models for the public API. Pure functions of (repository, clock, config) so the same
 * logic serves REST, WebSocket pushes and MCP tools.
 *
 * Honesty rules (PRD 0.7): missing data stays null or empty; nothing is interpolated or
 * defaulted into a plausible-looking number. MOCK rows never leave this layer unless
 * ALLOW_MOCK is set outside production.
 */
import { NETWORKS } from "@strata/config";
import type {
  AgentDetailResponse,
  AgentProfile,
  BookSnapshot,
  EpochListResponse,
  EpochResponse,
  HeroStatsResponse,
  LeaderboardResponse,
  LeaderboardRow,
  MarketDetailResponse,
  MarketSummary,
  MarketsResponse,
  NetworkName,
  Provenance,
  StatusResponse,
  TransparencyResponse,
  AgentsResponse,
  EpochScore,
} from "@strata/sdk";
import { HttpError } from "../errors.js";
import type { Heartbeat, Repository } from "../repo/types.js";
import { isSafeMetadataUri } from "./metadata-uri.js";

export interface ReadContext {
  repo: Repository;
  now: () => number;
  allowMock: boolean;
  freshMs: number;
  oracleMaxAgeSec: number;
  heartbeatMaxAgeMs: number;
}

const HISTORY_WINDOW_MS = 24 * 3_600_000;
const HISTORY_BUCKET_MS = 5 * 60_000;
const DETAIL_LIMIT = 50;
const EVENT_LIMIT = 100;

/** Weakest first: a mixed set is labelled with its weakest member. */
const PROVENANCE_WEAKNESS: readonly Provenance[] = ["MOCK", "SIMULATED", "BACKTEST", "BASELINE", "TESTNET", "LIVE"];

export function visible<T extends { provenance: Provenance }>(ctx: ReadContext, rows: T[]): T[] {
  return ctx.allowMock ? rows : rows.filter((r) => r.provenance !== "MOCK");
}

function weakest(provenances: Provenance[], fallback: Provenance): Provenance {
  for (const p of PROVENANCE_WEAKNESS) if (provenances.includes(p)) return p;
  return fallback;
}

export function defaultProvenance(network: NetworkName): Provenance {
  return network === "mainnet" ? "LIVE" : "TESTNET";
}

function isFresh(ctx: ReadContext, at: number): boolean {
  return ctx.now() - at <= ctx.freshMs;
}

async function freshBooks(ctx: ReadContext, network: NetworkName): Promise<Map<string, BookSnapshot>> {
  const books = visible(ctx, await ctx.repo.latestBooks(network)).filter((b) => isFresh(ctx, b.at));
  return new Map(books.map((b) => [b.marketId, b]));
}

function summarize(market: MarketSummary["market"], book: BookSnapshot | undefined, baseline: MarketSummary["baseline"] | undefined): MarketSummary {
  return {
    market,
    now: book
      ? {
          spreadBps: book.spreadBps,
          depthUsd25: book.depthUsd25,
          strataDepthUsd25: book.strataDepthUsd25,
          strataBookShare: book.depthUsd25 > 0 ? Math.min(1, book.strataDepthUsd25 / book.depthUsd25) : 0,
          sessionState: book.sessionState,
          at: book.at,
          provenance: book.provenance,
        }
      : null,
    baseline: baseline ?? null,
  };
}

async function baselinesByMarket(ctx: ReadContext, network: NetworkName) {
  const stats = await ctx.repo.baselineStats(network);
  return new Map(stats.map(({ marketId, ...rest }) => [marketId, rest]));
}

export async function getMarkets(ctx: ReadContext, network: NetworkName): Promise<MarketsResponse> {
  const [markets, books, baselines] = await Promise.all([
    ctx.repo.listMarkets(network),
    freshBooks(ctx, network),
    baselinesByMarket(ctx, network),
  ]);
  return {
    network,
    markets: markets.map((m) => summarize(m, books.get(m.marketId), baselines.get(m.marketId))),
    at: ctx.now(),
  };
}

export async function getMarketDetail(ctx: ReadContext, network: NetworkName, marketId: string): Promise<MarketDetailResponse> {
  const market = await ctx.repo.getMarket(network, marketId);
  if (!market) throw new HttpError("not_found", "market not found");
  const now = ctx.now();
  const [latest, baselines, history, oracle] = await Promise.all([
    ctx.repo.latestBook(network, marketId),
    baselinesByMarket(ctx, network),
    ctx.repo.liquidityHistory(network, marketId, now - HISTORY_WINDOW_MS, HISTORY_BUCKET_MS),
    ctx.repo.latestOracle(network, marketId),
  ]);
  const book = latest && visible(ctx, [latest]).length === 1 ? latest : null;
  const ageSec = oracle ? Math.max(0, Math.round((now - oracle.timestamp) / 1000)) : null;
  return {
    summary: summarize(market, book && isFresh(ctx, book.at) ? book : undefined, baselines.get(marketId)),
    book,
    history: visible(ctx, history),
    oracle: {
      price: oracle?.price ?? null,
      timestamp: oracle?.timestamp ?? null,
      ageSec,
      healthy: ageSec !== null && ageSec <= ctx.oracleMaxAgeSec,
    },
  };
}

/** Empty means "no metadata"; any non-https, non-ipfs value is withheld (L-8). */
function withSafeMetadata(agent: AgentProfile): AgentProfile {
  return agent.metadataURI === "" || isSafeMetadataUri(agent.metadataURI) ? agent : { ...agent, metadataURI: "" };
}

export async function getAgents(ctx: ReadContext, network: NetworkName): Promise<AgentsResponse> {
  return { network, agents: (await ctx.repo.listAgents(network)).map(withSafeMetadata), at: ctx.now() };
}

type Scalar = number | string | boolean;

/** Keep only scalar values; nested structures are not part of the public limits contract. */
function scalarRecord(value: unknown): Record<string, Scalar> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const out: Record<string, Scalar> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") out[k] = v;
  }
  return out;
}

/** Agents publish limits and capital in their heartbeat detail under service `agent:<id>`. */
function agentHeartbeat(beats: Heartbeat[], agentId: number): Heartbeat | undefined {
  return beats.find((h) => h.service === `agent:${agentId}`);
}

export async function getAgentDetail(ctx: ReadContext, network: NetworkName, agentId: number): Promise<AgentDetailResponse> {
  const found = await ctx.repo.getAgent(network, agentId);
  if (!found) throw new HttpError("not_found", "agent not found");
  const agent = withSafeMetadata(found);
  const since = ctx.now() - ctx.freshMs;
  const [quotes, fills, scores, guards, tuners, beats] = await Promise.all([
    ctx.repo.liveQuotes(network, agentId, since),
    ctx.repo.recentFills(network, agentId, DETAIL_LIMIT),
    ctx.repo.agentScores(network, agentId, DETAIL_LIMIT),
    ctx.repo.guardEvents(network, { agentId, limit: DETAIL_LIMIT }),
    ctx.repo.tunerEvents(network, { agentId, limit: DETAIL_LIMIT }),
    ctx.repo.heartbeats(network),
  ]);
  return {
    agent,
    liveQuotes: visible(ctx, quotes),
    recentFills: visible(ctx, fills),
    scores: visible(ctx, scores),
    guardEvents: visible(ctx, guards),
    tunerEvents: tuners,
    limits: scalarRecord(agentHeartbeat(beats, agentId)?.detail["limits"]),
  };
}

function toRow(network: NetworkName, s: EpochScore, agent: AgentProfile, rank: number, previousRank: number | null): LeaderboardRow {
  return {
    network,
    provenance: s.provenance,
    rank,
    previousRank,
    agentId: s.agentId,
    name: agent.name,
    kind: agent.kind,
    status: agent.status,
    score: s.score,
    quotedSpreadBps: s.metrics.quotedSpreadBps,
    depthUsd25: s.metrics.depthUsd25,
    uptimeBps: s.metrics.uptimeBps,
    pnlUsd: s.metrics.pnlUsd,
    marketIds: agent.marketIds,
    lastEpoch: s.epoch,
  };
}

function ranked(scores: EpochScore[]): EpochScore[] {
  return [...scores].sort((a, b) => b.score - a.score || a.agentId - b.agentId);
}

export async function getLeaderboard(ctx: ReadContext, network: NetworkName, seasonParam: number | undefined): Promise<LeaderboardResponse> {
  const season = seasonParam ?? (await ctx.repo.latestSeason(network)) ?? 0;
  const [epochs, agents] = await Promise.all([ctx.repo.scoredEpochs(network, season, 2), ctx.repo.listAgents(network)]);
  const [latest, previous] = epochs;
  const base = { network, season, seasonEndsAt: null, at: ctx.now() };
  if (latest === undefined) return { ...base, epoch: null, rows: [] };

  const [current, prior] = await Promise.all([
    ctx.repo.epochScores(network, season, latest),
    previous === undefined ? Promise.resolve([]) : ctx.repo.epochScores(network, season, previous),
  ]);
  const agentById = new Map(agents.map((a) => [a.agentId, a]));
  const priorRank = new Map(ranked(visible(ctx, prior)).map((s, i) => [s.agentId, i + 1]));
  const rows: LeaderboardRow[] = [];
  for (const s of ranked(visible(ctx, current))) {
    const agent = agentById.get(s.agentId);
    // A score without a registered profile cannot be labelled honestly, so it is omitted.
    if (!agent) continue;
    rows.push(toRow(network, s, agent, rows.length + 1, priorRank.get(s.agentId) ?? null));
  }
  return { ...base, epoch: latest, rows };
}

export async function getEpochs(ctx: ReadContext, network: NetworkName): Promise<EpochListResponse> {
  return { network, epochs: await ctx.repo.listEpochs(network, DETAIL_LIMIT) };
}

export async function getEpoch(ctx: ReadContext, network: NetworkName, season: number, epoch: number): Promise<EpochResponse> {
  const attestation = await ctx.repo.getEpoch(network, season, epoch);
  if (!attestation) throw new HttpError("not_found", "epoch not found");
  return { attestation, scores: visible(ctx, await ctx.repo.epochScores(network, season, epoch)) };
}

export async function getTransparency(ctx: ReadContext, network: NetworkName): Promise<TransparencyResponse> {
  const [agents, beats, guards, epochs] = await Promise.all([
    ctx.repo.listAgents(network),
    ctx.repo.heartbeats(network),
    ctx.repo.guardEvents(network, { limit: EVENT_LIMIT }),
    ctx.repo.listEpochs(network, DETAIL_LIMIT),
  ]);
  const visibleGuards = visible(ctx, guards);
  const houseAgents: TransparencyResponse["houseAgents"] = [];
  for (const a of agents.filter((x) => x.kind === "house")) {
    const detail = agentHeartbeat(beats, a.agentId)?.detail;
    const capital = detail?.["capitalUsd"];
    // Capital is only shown when the agent itself reports it; no placeholder figure.
    if (typeof capital !== "number" || !Number.isFinite(capital) || capital < 0) continue;
    houseAgents.push({ agentId: a.agentId, name: a.name, injAddress: a.injAddress, capitalUsd: capital, limits: scalarRecord(detail?.["limits"]) });
  }
  const suspensions: TransparencyResponse["suspensions"] = [];
  for (const a of agents.filter((x) => x.status === "suspended")) {
    const halt = visibleGuards.find((g) => g.agentId === a.agentId && g.action === "halt");
    if (halt) suspensions.push({ agentId: a.agentId, reason: a.statusReason ?? halt.detail, at: halt.at });
  }
  const contracts = NETWORKS[network].contracts;
  return {
    network,
    contracts: { arena: contracts.arena, attestor: contracts.attestor, rewards: contracts.rewards },
    houseAgents,
    guardEvents: visibleGuards,
    suspensions,
    epochs,
  };
}

export async function getStatus(ctx: ReadContext, network: NetworkName): Promise<StatusResponse> {
  const now = ctx.now();
  const [beats, books, lastEpochPosted] = await Promise.all([
    ctx.repo.heartbeats(network),
    ctx.repo.latestBooks(network),
    ctx.repo.latestPostedEpoch(network),
  ]);
  const services = beats.map((h) => {
    const ageSec = Math.max(0, Math.round((now - h.at) / 1000));
    const ok = now - h.at <= ctx.heartbeatMaxAgeMs;
    return { name: h.service, ok, detail: ok ? `heartbeat ${ageSec}s ago` : `no heartbeat for ${ageSec}s`, lastSeenAt: h.at };
  });
  services.unshift({ name: "database", ok: true, detail: "reachable", lastSeenAt: now });
  const height = beats.find((h) => h.service === "indexer")?.detail["lastBlockHeight"];
  const newestBook = visible(ctx, books).reduce<number | null>((m, b) => (m === null || b.at > m ? b.at : m), null);
  return {
    network,
    services,
    lastBlockHeight: typeof height === "number" && Number.isSafeInteger(height) && height >= 0 ? height : null,
    dataLagSec: newestBook === null ? null : Math.max(0, (now - newestBook) / 1000),
    lastEpochPosted,
    at: now,
  };
}

export async function getHeroStats(ctx: ReadContext, network: NetworkName): Promise<HeroStatsResponse> {
  const [markets, books, baselines, quoting] = await Promise.all([
    ctx.repo.listMarkets(network),
    freshBooks(ctx, network),
    baselinesByMarket(ctx, network),
    ctx.repo.quotingAgentCount(network, ctx.now() - ctx.freshMs),
  ]);
  const layers: HeroStatsResponse["layers"] = [];
  const improvements: number[] = [];
  const provenances: Provenance[] = [];
  for (const m of markets.filter((x) => x.arenaEnabled)) {
    const book = books.get(m.marketId);
    if (!book) continue;
    provenances.push(book.provenance);
    layers.push({ marketId: m.marketId, symbol: m.symbol, depthUsd25: book.depthUsd25, strataDepthUsd25: book.strataDepthUsd25 });
    const base = baselines.get(m.marketId)?.spreadBps;
    if (base !== null && base !== undefined && book.spreadBps !== null) improvements.push(base - book.spreadBps);
  }
  return {
    network,
    provenance: weakest(provenances, defaultProvenance(network)),
    agentsLive: quoting,
    marketsCovered: layers.length,
    strataDepthUsd25: layers.reduce((s, l) => s + l.strataDepthUsd25, 0),
    spreadImprovementBps: improvements.length ? improvements.reduce((s, x) => s + x, 0) / improvements.length : null,
    layers,
    at: ctx.now(),
  };
}
