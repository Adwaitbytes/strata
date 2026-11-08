/**
 * Development-only data source. Every object is stamped provenance "MOCK" and passes through
 * the same sdk schemas as live responses. The client refuses to use this module when
 * NODE_ENV is production (see client.ts), and assertNoMockDeep is a second line of defence.
 *
 * Market IDs, addresses and hashes here are obviously synthetic (repeated digits) so nobody
 * can mistake them for real Injective identifiers.
 */
import {
  buildTree,
  encodeLeaf,
  mockAgent,
  mockBook,
  mockLeaderboard,
  toLeafInput,
  type AgentDetailResponse,
  type AgentsResponse,
  type EpochAttestation,
  type EpochResponse,
  type EpochScore,
  type GuardEvent,
  type LeaderboardResponse,
  type LeaderboardRow,
  type LiquiditySample,
  type Market,
  type MarketDetailResponse,
  type MarketsResponse,
  type MarketSummary,
  type NetworkName,
  type Quote,
  type StatusResponse,
  type TransparencyResponse,
  type TunerEvent,
} from "@strata/sdk";

const HOUR = 3_600_000;
const SEASON = 0;
const LATEST_EPOCH = 12;
const MOCK_SOURCE = "https://mock.strata.invalid/indexer";
const ZERO_ADDRESS = `0x${"0".repeat(40)}`;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const marketId = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;
const hash32 = (n: number) => `0x${n.toString(16).padStart(2, "0").repeat(32)}`;

const MARKET_DEFS = [
  { n: 1, ticker: "MOCK-EQ/USDT PERP", symbol: "MOCK-EQ", assetClass: "equity", mid: 182.4 },
  { n: 2, ticker: "MOCK-FX/USDT PERP", symbol: "MOCK-FX", assetClass: "fx", mid: 1.0843 },
  { n: 3, ticker: "MOCK-GPU/USDT PERP", symbol: "MOCK-GPU", assetClass: "compute", mid: 2.31 },
] as const;

function market(network: NetworkName, def: (typeof MARKET_DEFS)[number], now: number): Market {
  return {
    network,
    marketId: marketId(def.n),
    ticker: def.ticker,
    symbol: def.symbol,
    assetClass: def.assetClass,
    quoteDenom: "mock-usdt",
    quoteDecimals: 6,
    oracleType: "mock",
    oracleBase: def.symbol,
    oracleQuote: "USD",
    minPriceTickSize: "0.01",
    minQuantityTickSize: "0.001",
    minNotional: "1",
    makerFeeRate: "-0.0001",
    takerFeeRate: "0.0005",
    initialMarginRatio: "0.05",
    maintenanceMarginRatio: "0.025",
    isPerpetual: true,
    arenaEnabled: true,
    maxSpreadBps: 50,
    minDepthUsd: 5000,
    fetchedAt: now,
    source: MOCK_SOURCE,
  };
}

function rankedRows(network: NetworkName, tick: number): LeaderboardRow[] {
  const rows = mockLeaderboard(network, 6, 7 + tick);
  const statuses: LeaderboardRow["status"][] = ["active", "active", "active", "halted", "active", "suspended"];
  const names = ["aqueduct", "basalt", "cirrus", "delta-maker", "ember", "fjord"];
  const jitter = rng(1000 + tick);
  const withMeta = rows.map((r, i) => ({
    ...r,
    score: Math.max(0, Math.min(10_000, r.score + Math.round((jitter() - 0.5) * 1600))),
    name: `${names[i] ?? r.name} (mock)`,
    status: statuses[i] ?? "active",
    marketIds: [marketId((i % 3) + 1)],
  }));
  return [...withMeta].sort((a, b) => b.score - a.score).map((r, i) => ({ ...r, rank: i + 1 }));
}

/** Ranks at `tick`, with previousRank taken from `tick - 1` so rank changes are real reorderings. */
function leaderboardRows(network: NetworkName, tick: number): LeaderboardRow[] {
  const previous = new Map(rankedRows(network, tick - 1).map((r) => [r.agentId, r.rank]));
  return rankedRows(network, tick).map((r) => ({ ...r, previousRank: previous.get(r.agentId) ?? null }));
}

export function mockLeaderboardResponse(network: NetworkName, tick = 0): LeaderboardResponse {
  const now = Date.now();
  if (network === "mainnet") {
    return { network, season: SEASON, epoch: null, seasonEndsAt: Date.UTC(2026, 11, 10), rows: [], at: now };
  }
  return {
    network,
    season: SEASON,
    epoch: LATEST_EPOCH,
    seasonEndsAt: Date.UTC(2026, 11, 10),
    rows: leaderboardRows(network, tick),
    at: now,
  };
}

function history(def: (typeof MARKET_DEFS)[number], now: number): LiquiditySample[] {
  const r = rng(def.n * 13);
  const samples: LiquiditySample[] = [];
  const points = 96;
  for (let i = 0; i < points; i++) {
    const at = now - (points - i) * 15 * 60_000;
    const baseline = i < 40;
    const quoting = i >= 48;
    const spread = quoting ? 9 + r() * 6 : 28 + r() * 14;
    const depth = quoting ? 18_000 + r() * 6_000 : 6_000 + r() * 3_000;
    samples.push({
      at,
      spreadBps: Math.round(spread * 10) / 10,
      depthUsd25: Math.round(depth),
      // Samples 40 to 47: indexer running, STRATA not quoting yet. Labeled by provenance, not "With STRATA".
      strataDepthUsd25: quoting ? Math.round(depth * (0.35 + r() * 0.15)) : 0,
      provenance: baseline ? "BASELINE" : "MOCK",
    });
  }
  return samples;
}

function summary(network: NetworkName, def: (typeof MARKET_DEFS)[number], now: number): MarketSummary {
  const h = history(def, now);
  const last = h[h.length - 1]!;
  const base = h.filter((s) => s.provenance === "BASELINE");
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
  return {
    market: market(network, def, now),
    now: {
      spreadBps: last.spreadBps,
      depthUsd25: last.depthUsd25,
      strataDepthUsd25: last.strataDepthUsd25,
      strataBookShare: last.depthUsd25 > 0 ? last.strataDepthUsd25 / last.depthUsd25 : 0,
      sessionState: def.assetClass === "equity" ? "open" : "always_open",
      at: now,
      provenance: "MOCK",
    },
    baseline: {
      spreadBps: Math.round(avg(base.map((s) => s.spreadBps ?? 0)) * 10) / 10,
      depthUsd25: Math.round(avg(base.map((s) => s.depthUsd25))),
      windowStart: base[0]!.at,
      windowEnd: base[base.length - 1]!.at,
      samples: base.length,
    },
  };
}

export function mockMarketsResponse(network: NetworkName): MarketsResponse {
  const now = Date.now();
  if (network === "mainnet") return { network, markets: [], at: now };
  return { network, markets: MARKET_DEFS.map((d) => summary(network, d, now)), at: now };
}

export function mockMarketDetail(network: NetworkName, id: string, tick = 0): MarketDetailResponse | null {
  const def = MARKET_DEFS.find((d) => marketId(d.n) === id.toLowerCase());
  if (!def || network === "mainnet") return null;
  const now = Date.now();
  const book = mockBook(network, def.mid, 3 + tick);
  return {
    summary: summary(network, def, now),
    book: { ...book, marketId: marketId(def.n), at: now, oracleTimestamp: now - 4_000 },
    history: history(def, now),
    oracle: { price: def.mid.toFixed(4), timestamp: now - 4_000, ageSec: 4, healthy: true },
  };
}

function epochScores(network: NetworkName, epoch: number): EpochScore[] {
  const rows = leaderboardRows(network, epoch);
  const base = rows.map((r) => ({
    network,
    provenance: "MOCK" as const,
    season: SEASON,
    epoch,
    agentId: r.agentId,
    score: r.score,
    metrics: {
      quotedSpreadBps: r.quotedSpreadBps,
      depthUsd25: r.depthUsd25,
      uptimeBps: r.uptimeBps,
      bookShare: 0.1 + r.agentId * 0.03,
      markout60s: 0.2 - r.agentId * 0.05,
      pnlUsd: r.pnlUsd,
      maxDrawdownUsd: 12 + r.agentId * 3,
      spreadImprovementBps: 18 - r.agentId,
      samples: 720,
    },
    flags: r.status === "suspended" ? 1 : 0,
    flagNames: r.status === "suspended" ? ["WASH"] : [],
  }));
  const leaves = base.map((s) =>
    encodeLeaf(
      toLeafInput({
        season: s.season,
        epoch: s.epoch,
        agentId: s.agentId,
        score: s.score,
        quotedSpreadBps: s.metrics.quotedSpreadBps,
        depthUsd25: s.metrics.depthUsd25,
        uptimeBps: s.metrics.uptimeBps,
        pnlUsd: s.metrics.pnlUsd,
        flags: s.flags,
      }),
    ),
  );
  const tree = buildTree(leaves);
  mockRoots.set(`${network}:${epoch}`, tree.root);
  return base.map((s, i) => ({ ...s, leaf: leaves[i]!, proof: tree.proofs[i]! }));
}

const mockRoots = new Map<string, string>();

function attestation(network: NetworkName, epoch: number): EpochAttestation {
  if (!mockRoots.has(`${network}:${epoch}`)) epochScores(network, epoch);
  const end = Date.now() - (LATEST_EPOCH - epoch) * HOUR;
  return {
    network,
    season: SEASON,
    epoch,
    startTime: end - HOUR,
    endTime: end,
    merkleRoot: mockRoots.get(`${network}:${epoch}`)!,
    dataURI: `${MOCK_SOURCE}/epochs/${SEASON}/${epoch}.json`,
    txHash: null,
    postedAt: null,
    contract: ZERO_ADDRESS,
  };
}

export function mockEpoch(network: NetworkName, epoch: number): EpochResponse | null {
  if (network === "mainnet" || epoch > LATEST_EPOCH) return null;
  const scores = epochScores(network, epoch);
  return { attestation: attestation(network, epoch), scores };
}

function guardEvents(network: NetworkName, agentId: number | null): GuardEvent[] {
  const now = Date.now();
  const all: GuardEvent[] = [
    {
      network,
      provenance: "MOCK",
      id: "g-1",
      agentId: 4,
      marketId: marketId(1),
      guard: "oracle",
      action: "halt",
      reason: "oracle_stale",
      detail: "Oracle price was 41 seconds old, over the 30 second limit. Quoting paused.",
      observed: { oracleAgeSec: 41, limitSec: 30 },
      at: now - 25 * 60_000,
    },
    {
      network,
      provenance: "MOCK",
      id: "g-2",
      agentId: 1,
      marketId: marketId(1),
      guard: "session",
      action: "widen",
      reason: "session_pre_close",
      detail: "Market closes in 15 minutes. Spreads widened 2x and size halved.",
      observed: { minutesToClose: 15 },
      at: now - 2 * HOUR,
    },
    {
      network,
      provenance: "MOCK",
      id: "g-3",
      agentId: 2,
      marketId: marketId(2),
      guard: "risk",
      action: "reduce",
      reason: "risk_net_notional",
      detail: "Net position reached 82% of the limit. Skewed quotes to reduce inventory.",
      observed: { netNotionalUsd: 410, limitUsd: 500 },
      at: now - 5 * HOUR,
    },
    {
      network,
      provenance: "MOCK",
      id: "g-4",
      agentId: 1,
      marketId: marketId(1),
      guard: "oracle",
      action: "resume",
      reason: "oracle_stale",
      detail: "Oracle updates resumed. Quoting restarted at reduced size.",
      observed: { oracleAgeSec: 3 },
      at: now - 7 * HOUR,
    },
  ];
  return agentId == null ? all : all.filter((e) => e.agentId === agentId);
}

function tunerEvents(network: NetworkName, agentId: number): TunerEvent[] {
  const now = Date.now();
  const params = { gamma: 0.1, minHalfSpreadBps: 4, levels: 3, sizeMultiplier: 1, offHoursQuoting: false };
  return [
    {
      network,
      id: "t-1",
      agentId,
      marketId: marketId(1),
      mode: "shadow",
      model: "mock-model",
      before: params,
      suggested: { ...params, minHalfSpreadBps: 5.5 },
      applied: null,
      clamped: ["minHalfSpreadBps"],
      rationale: "Realized volatility rose 40% over the last hour while markouts turned negative. Wider minimum spread should reduce adverse selection.",
      rejected: false,
      rejectReason: null,
      at: now - 40 * 60_000,
    },
    {
      network,
      id: "t-2",
      agentId,
      marketId: marketId(1),
      mode: "shadow",
      model: "mock-model",
      before: params,
      suggested: { ...params, levels: 8 },
      applied: null,
      clamped: [],
      rationale: "Book is thin beyond 10 bps. More levels would add depth.",
      rejected: true,
      rejectReason: "levels above the bound of 5",
      at: now - 3 * HOUR,
    },
  ];
}

function quotes(network: NetworkName, agentId: number, tick: number): Quote[] {
  const r = rng(agentId * 31 + tick);
  const mid = 182.4;
  const now = Date.now();
  const out: Quote[] = [];
  for (let level = 0; level < 3; level++) {
    for (const side of ["buy", "sell"] as const) {
      const offset = (0.04 + level * 0.06 + r() * 0.02) * (side === "buy" ? -1 : 1);
      out.push({
        network,
        provenance: "MOCK",
        agentId,
        marketId: marketId(1),
        orderHash: hash32(level * 2 + (side === "buy" ? 1 : 2)),
        side,
        price: (mid + offset).toFixed(2),
        quantity: (0.5 + r() * 2).toFixed(3),
        level,
        postedAt: now - Math.round(r() * 4000),
        cancelledAt: null,
      });
    }
  }
  return out;
}

export function mockAgentDetail(network: NetworkName, id: number, tick = 0): AgentDetailResponse | null {
  if (network === "mainnet") return null;
  const row = leaderboardRows(network, 0).find((r) => r.agentId === id);
  if (!row) return null;
  const base = mockAgent(network, id);
  const scores: EpochScore[] = [];
  for (let e = 1; e <= LATEST_EPOCH; e++) {
    const s = epochScores(network, e).find((x) => x.agentId === id);
    if (s) scores.push(s);
  }
  return {
    agent: {
      ...base,
      name: row.name,
      kind: row.kind,
      status: row.status,
      statusReason:
        row.status === "suspended" ? "Wash trading flag in epoch 11" : row.status === "halted" ? "Oracle guard halted quoting" : null,
      marketIds: row.marketIds,
      enrolledAt: Date.now() - 4 * 24 * HOUR,
      erc8004Id: id <= 2 ? String(100 + id) : null,
    },
    liveQuotes: row.status === "active" ? quotes(network, id, tick) : [],
    recentFills: [],
    scores,
    guardEvents: guardEvents(network, id),
    tunerEvents: tunerEvents(network, id),
    limits: { maxGrossNotionalUsd: 1000, maxNetNotionalUsd: 500, maxDailyLossUsd: 50, maxOrdersPerMin: 120 },
  };
}

export function mockAgentsResponse(network: NetworkName): AgentsResponse {
  const now = Date.now();
  if (network === "mainnet") return { network, agents: [], at: now };
  const agents = leaderboardRows(network, 0)
    .map((r) => mockAgentDetail(network, r.agentId)?.agent)
    .filter((a): a is NonNullable<typeof a> => a != null);
  return { network, agents, at: now };
}

export function mockTransparency(network: NetworkName): TransparencyResponse {
  if (network === "mainnet") {
    return {
      network,
      contracts: { arena: null, attestor: null, rewards: null },
      houseAgents: [],
      guardEvents: [],
      suspensions: [],
      epochs: [],
    };
  }
  return {
    network,
    contracts: { arena: null, attestor: null, rewards: null },
    houseAgents: [1, 2].map((id) => ({
      agentId: id,
      name: `${id === 1 ? "aqueduct" : "basalt"} (mock)`,
      injAddress: "inj1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq",
      capitalUsd: 500,
      limits: { maxGrossNotionalUsd: 1000, maxNetNotionalUsd: 500, maxDailyLossUsd: 50, maxDrawdownUsd: 150 },
    })),
    guardEvents: guardEvents(network, null),
    suspensions: [{ agentId: 6, reason: "Wash trading flag in epoch 11", at: Date.now() - 6 * HOUR }],
    epochs: [LATEST_EPOCH, LATEST_EPOCH - 1, LATEST_EPOCH - 2].map((e) => attestation(network, e)),
  };
}

export function mockStatus(network: NetworkName): StatusResponse {
  const now = Date.now();
  const services = ["api", "indexer", "scorer", "agent:aqueduct", "agent:basalt"].map((name, i) => ({
    name,
    ok: i !== 4,
    detail: i === 4 ? "Halted by oracle guard" : "Running",
    lastSeenAt: now - (i + 1) * 3_000,
  }));
  return {
    network,
    services: network === "mainnet" ? [] : services,
    lastBlockHeight: network === "mainnet" ? null : 98_765_432,
    dataLagSec: network === "mainnet" ? null : 2.4,
    lastEpochPosted: network === "mainnet" ? null : attestation(network, LATEST_EPOCH),
    at: now,
  };
}

export const MOCK_MARKET_IDS = MARKET_DEFS.map((d) => marketId(d.n));
