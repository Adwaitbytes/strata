/**
 * Deterministic mock generators that satisfy the schemas exactly (PRD 19.6).
 * Every object is stamped provenance "MOCK". apps/web must refuse to render MOCK data
 * when NODE_ENV === "production" (enforced by assertNotMockInProduction).
 */
import type { AgentProfile, BookSnapshot, LeaderboardRow, NetworkName } from "./types.js";

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

const MOCK_MARKET_ID = (n: number) => (`0x${n.toString(16).padStart(64, "0")}` as const);

export function mockLeaderboard(network: NetworkName, count = 6, seed = 7): LeaderboardRow[] {
  const r = rng(seed);
  return Array.from({ length: count }, (_, i) => ({
    network,
    provenance: "MOCK" as const,
    rank: i + 1,
    previousRank: i === 0 ? 2 : i === 1 ? 1 : i + 1,
    agentId: i + 1,
    name: `mock-agent-${i + 1}`,
    kind: i < 2 ? ("house" as const) : ("third_party" as const),
    status: "active" as const,
    score: Math.round(9000 - i * 900 - r() * 300),
    quotedSpreadBps: Math.round((4 + i * 2 + r() * 3) * 10) / 10,
    depthUsd25: Math.round(20_000 - i * 2_500 + r() * 1_000),
    uptimeBps: Math.round(9_900 - i * 250 - r() * 100),
    pnlUsd: Math.round((r() - 0.4) * 400) / 10,
    marketIds: [MOCK_MARKET_ID(i + 1)],
    lastEpoch: 12,
  }));
}

export function mockAgent(network: NetworkName, agentId = 1): AgentProfile {
  return {
    network,
    agentId,
    name: `mock-agent-${agentId}`,
    kind: "house",
    operator: `0x${"1".repeat(40)}`,
    injAddress: "inj1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq",
    subaccountId: MOCK_MARKET_ID(agentId),
    erc8004Id: null,
    metadataURI: "",
    marketIds: [MOCK_MARKET_ID(1)],
    status: "active",
    statusReason: null,
    enrolledAt: 0,
    simulated: false,
  };
}

export function mockBook(network: NetworkName, mid = 100, seed = 3): BookSnapshot {
  const r = rng(seed);
  const level = (p: number) => ({ price: p.toFixed(2), quantity: (1 + r() * 5).toFixed(3), strataQuantity: (r() * 2).toFixed(3) });
  return {
    network,
    provenance: "MOCK",
    marketId: MOCK_MARKET_ID(1),
    bids: Array.from({ length: 10 }, (_, i) => level(mid - 0.05 - i * 0.05)),
    asks: Array.from({ length: 10 }, (_, i) => level(mid + 0.05 + i * 0.05)),
    mid: mid.toFixed(2),
    spreadBps: 10,
    depthUsd25: 12_000,
    strataDepthUsd25: 4_000,
    oraclePrice: mid.toFixed(2),
    oracleTimestamp: 0,
    sessionState: "open",
    at: 0,
  };
}

export class MockInProductionError extends Error {}

export function assertNotMockInProduction(provenance: string, env: string | undefined): void {
  if (provenance === "MOCK" && env === "production") {
    throw new MockInProductionError("MOCK data reached a production view");
  }
}
