/**
 * Hand-built fixture for the golden-file test. Market IDs, addresses and prices are synthetic
 * test values (not real Injective markets); the network label is testnet.
 *
 * Season 1, epoch 2, 5-minute epochs (60 samples). Two markets:
 *  - MKT_A: mid 100, steps to 100.2 at +150 s. Total book depth $20,000 within 25 bps.
 *  - MKT_B: mid 50. Book data is missing from +100 s to +160 s (a 60 s indexer gap).
 * Agents:
 *  1. Tight, deep, two-sided on both markets all epoch. One buy fill on A before the mid step (good markout).
 *  2. Wider quotes on A only, ask side drops out halfway. One sell fill on A before the step (bad markout).
 *     Also posts flicker orders (alive 400 ms) that must not count.
 *  3 and 4. Same operator, trade against each other on B: both flagged WASH.
 *  5. Enrolled, never quotes.
 */
import type { EpochData, SeasonInfo } from "../../src/epoch.js";
import type { AgentRecord, BookSample, FillRecord, OrderRecord } from "../../src/model.js";

export const MKT_A = "0x" + "a1".repeat(32);
export const MKT_B = "0x" + "b2".repeat(32);
const addr = (n: number) => "0x" + n.toString(16).padStart(40, "0");
const sub = (n: number) => addr(n) + "0".repeat(24);

export const SEASON: SeasonInfo = {
  season: 1,
  startMs: 1_765_000_000_000,
  endMs: 1_765_000_000_000 + 24 * 3_600_000,
  epochSeconds: 300,
  active: true,
};
export const EPOCH = 2;
const S = SEASON.startMs + EPOCH * 300_000;
const E = S + 300_000;

function book(from: number, to: number, mid: (t: number) => number, depth: number, spreadBps: number, gap?: [number, number]): BookSample[] {
  const out: BookSample[] = [];
  for (let t = from; t <= to; t += 5_000) {
    if (gap && t >= gap[0] && t < gap[1]) continue;
    out.push({ at: t, mid: mid(t), spreadBps, depthUsd25: depth });
  }
  return out;
}

const agents: AgentRecord[] = [
  { agentId: 1, operator: addr(0x1001), subaccountId: sub(0x1001), status: "active", marketIds: [MKT_A, MKT_B], simulated: false, enrolledAt: SEASON.startMs },
  { agentId: 2, operator: addr(0x2002), subaccountId: sub(0x2002), status: "active", marketIds: [MKT_A], simulated: false, enrolledAt: SEASON.startMs },
  { agentId: 3, operator: addr(0x3333), subaccountId: sub(0x3003), status: "active", marketIds: [MKT_B], simulated: false, enrolledAt: SEASON.startMs },
  { agentId: 4, operator: addr(0x3333), subaccountId: sub(0x4004), status: "active", marketIds: [MKT_B], simulated: false, enrolledAt: SEASON.startMs },
  { agentId: 5, operator: addr(0x5005), subaccountId: sub(0x5005), status: "active", marketIds: [MKT_A], simulated: false, enrolledAt: SEASON.startMs },
];

const o = (agentId: number, marketId: string, orderHash: string, side: "buy" | "sell", price: number, quantity: number, postedAt: number, cancelledAt: number | null): OrderRecord => ({
  agentId,
  marketId,
  orderHash,
  side,
  price,
  quantity,
  postedAt,
  cancelledAt,
});

const orders: OrderRecord[] = [
  o(1, MKT_A, "1a-b", "buy", 99.96, 40, S - 60_000, null),
  o(1, MKT_A, "1a-a", "sell", 100.04, 40, S - 60_000, null),
  o(1, MKT_B, "1b-b", "buy", 49.99, 60, S - 60_000, null),
  o(1, MKT_B, "1b-a", "sell", 50.01, 60, S - 60_000, null),
  o(2, MKT_A, "2a-b", "buy", 99.9, 20, S - 30_000, null),
  o(2, MKT_A, "2a-a", "sell", 100.1, 20, S - 30_000, S + 150_000),
  o(2, MKT_A, "2a-f1", "buy", 99.98, 500, S + 40_000 - 200, S + 40_000 + 200),
  o(2, MKT_A, "2a-f2", "sell", 100.02, 500, S + 40_000 - 200, S + 40_000 + 200),
  o(3, MKT_B, "3b-b", "buy", 49.98, 30, S, null),
  o(3, MKT_B, "3b-a", "sell", 50.02, 30, S, null),
  o(4, MKT_B, "4b-b", "buy", 49.97, 30, S, null),
  o(4, MKT_B, "4b-a", "sell", 50.03, 30, S, null),
];

const f = (id: string, agentId: number, marketId: string, orderHash: string, side: "buy" | "sell", price: number, quantity: number, feeUsd: number, cp: string | null, executedAt: number): FillRecord => ({
  id,
  agentId,
  marketId,
  orderHash,
  side,
  price,
  quantity,
  feeUsd,
  isMaker: true,
  counterpartySubaccountId: cp,
  executedAt,
});

const fills: FillRecord[] = [
  f("0xf1:0", 1, MKT_A, "1a-b", "buy", 99.96, 10, -0.05, sub(0x9999), S + 60_000),
  f("0xf2:0", 2, MKT_A, "2a-a", "sell", 100.1, 5, -0.02, sub(0x8888), S + 100_000),
  f("0xf3:0", 3, MKT_B, "3b-a", "sell", 50.02, 10, 0, sub(0x4004), S + 30_000),
  f("0xf3:1", 4, MKT_B, "4b-b", "buy", 50.02, 10, 0.1, sub(0x3003), S + 30_000),
];

const midA = (t: number) => (t >= S + 150_000 ? 100.2 : 100);
const bookA = book(S - 10_000, E + 75_000, midA, 20_000, 6);
const bookB = book(S - 10_000, E + 75_000, () => 50, 15_000, 8, [S + 100_000, S + 160_000]);

export const FIXTURE: EpochData = {
  network: "testnet",
  window: { season: SEASON.season, epoch: EPOCH, startMs: S, endMs: E },
  agents,
  markets: [
    { marketId: MKT_A, maxSpreadBps: 25 },
    { marketId: MKT_B, maxSpreadBps: 40 },
  ],
  book: new Map([
    [MKT_A, bookA],
    [MKT_B, bookB],
  ]),
  baselineSpreadBps: new Map([
    [MKT_A, 18],
    [MKT_B, 22],
  ]),
  orders,
  fills,
  funding: [],
  marks: new Map([
    [MKT_A, bookA.filter((b) => b.at < E).map((b) => ({ at: b.at, mid: b.mid! }))],
    [MKT_B, bookB.filter((b) => b.at < E).map((b) => ({ at: b.at, mid: b.mid! }))],
  ]),
  fundingEdges: [],
};

export const ATTESTOR_CONTRACT = "0x" + "c0".repeat(20);
