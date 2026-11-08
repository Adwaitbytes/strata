import { describe, expect, it } from "vitest";
import { aggregateAgentMetrics, computeMarketMetrics, sampleTimes, type MarketMetrics } from "./metrics.js";
import type { BookSample, EpochWindow, FillRecord, MarketParams, OrderRecord } from "./model.js";

const T0 = 1_700_000_000_000;
const MKT = "0x" + "11".repeat(32);
const window60: EpochWindow = { season: 1, epoch: 0, startMs: T0, endMs: T0 + 60_000 };
const market: MarketParams = { marketId: MKT, maxSpreadBps: 50 };

/** Flat book: mid 100, total depth $10,000 within 25 bps, a snapshot every 5 s from t0-5s to t0+150s. */
function flatBook(mid = 100, depth = 10_000): BookSample[] {
  const out: BookSample[] = [];
  for (let t = T0 - 5_000; t <= T0 + 150_000; t += 5_000) out.push({ at: t, mid, spreadBps: 4, depthUsd25: depth });
  return out;
}

function order(p: Partial<OrderRecord> & Pick<OrderRecord, "orderHash" | "side" | "price">): OrderRecord {
  return { agentId: 1, marketId: MKT, quantity: 10, postedAt: T0 - 1_000, cancelledAt: null, ...p };
}

function fill(p: Partial<FillRecord> & Pick<FillRecord, "id" | "orderHash" | "side" | "price" | "quantity" | "executedAt">): FillRecord {
  return { agentId: 1, marketId: MKT, feeUsd: 0, isMaker: true, counterpartySubaccountId: null, ...p };
}

const run = (over: Partial<Parameters<typeof computeMarketMetrics>[0]> = {}): MarketMetrics =>
  computeMarketMetrics({
    window: window60,
    market,
    book: flatBook(),
    orders: [],
    fills: [],
    excludedFillIds: new Set(),
    baselineSpreadBps: null,
    ...over,
  });

const twoSided = [
  order({ orderHash: "b1", side: "buy", price: 99.9 }),
  order({ orderHash: "a1", side: "sell", price: 100.1 }),
];

describe("sampleTimes", () => {
  it("samples every 5 s from the epoch start, end exclusive", () => {
    const ts = sampleTimes(window60);
    expect(ts).toHaveLength(12);
    expect(ts[0]).toBe(T0);
    expect(ts[11]).toBe(T0 + 55_000);
  });
});

describe("computeMarketMetrics", () => {
  it("measures a steady two-sided quote", () => {
    const m = run({ orders: twoSided });
    expect(m.totalSamples).toBe(12);
    expect(m.validSamples).toBe(12);
    expect(m.twoSidedSamples).toBe(12);
    expect(m.uptimeSamples).toBe(12);
    expect(m.quotedSpreadBps).toBeCloseTo(20, 9);
    // 99.9 * 10 + 100.1 * 10, both inside 25 bps of mid 100
    expect(m.depthUsd25).toBeCloseTo(2_000, 9);
    expect(m.bookShare).toBeCloseTo(0.2, 9);
  });

  it("counts spread only while both sides are live and time-weights depth over all samples", () => {
    const orders = [twoSided[0]!, order({ orderHash: "a1", side: "sell", price: 100.1, cancelledAt: T0 + 30_000 })];
    const m = run({ orders });
    expect(m.twoSidedSamples).toBe(6);
    expect(m.uptimeSamples).toBe(6);
    expect(m.quotedSpreadBps).toBeCloseTo(20, 9);
    expect(m.depthUsd25).toBeCloseTo((6 * 2_000 + 6 * 999) / 12, 9);
  });

  it("does not count uptime when the two-sided spread is wider than maxSpreadBps", () => {
    const wide = [order({ orderHash: "b", side: "buy", price: 99.7 }), order({ orderHash: "a", side: "sell", price: 100.3 })];
    const m = run({ orders: wide });
    expect(m.twoSidedSamples).toBe(12);
    expect(m.uptimeSamples).toBe(0);
    expect(m.quotedSpreadBps).toBeCloseTo(60, 9);
  });

  it("excludes orders outside 25 bps from depth but still uses them for spread", () => {
    const orders = [order({ orderHash: "b", side: "buy", price: 99 }), order({ orderHash: "a", side: "sell", price: 100.1 })];
    const m = run({ orders, market: { marketId: MKT, maxSpreadBps: 500 } });
    expect(m.depthUsd25).toBeCloseTo(1_001, 9);
    expect(m.quotedSpreadBps).toBeCloseTo(110, 9);
  });

  it("excludes flicker orders alive under 1 second from every book metric", () => {
    const flicker = [
      order({ orderHash: "fb", side: "buy", price: 99.9, postedAt: T0 + 9_800, cancelledAt: T0 + 10_300 }),
      order({ orderHash: "fa", side: "sell", price: 100.1, postedAt: T0 + 9_800, cancelledAt: T0 + 10_300 }),
    ];
    const m = run({ orders: flicker });
    expect(m.twoSidedSamples).toBe(0);
    expect(m.depthUsd25).toBe(0);
    expect(m.quotedSpreadBps).toBeNull();
  });

  it("uses remaining size after partial fills", () => {
    const fills = [fill({ id: "tx1:0", orderHash: "b1", side: "buy", price: 99.9, quantity: 4, executedAt: T0 + 2_000 })];
    const m = run({ orders: twoSided, fills });
    // sample 0: full size; samples 1..11: bid remaining 6
    const expected = (2_000 + 11 * (99.9 * 6 + 1_001)) / 12;
    expect(m.depthUsd25).toBeCloseTo(expected, 9);
  });

  it("skips samples with no fresh book snapshot and reports them as invalid", () => {
    const book = flatBook().filter((b) => !(b.at >= T0 + 20_000 && b.at <= T0 + 40_000));
    const m = run({ orders: twoSided, book });
    // snapshot at t0+15s covers t0+20s (5 s old) and t0+25s (10 s old); t0+30s..t0+40s have no snapshot younger than 15 s.
    expect(m.validSamples).toBe(12 - 3);
    expect(m.twoSidedSamples).toBe(9);
  });

  it("computes notional-weighted 60 s markout in USD and skips excluded fills", () => {
    const book = flatBook().map((b) => (b.at >= T0 + 70_000 ? { ...b, mid: 100.5 } : b));
    const fills = [
      fill({ id: "tx1:0", orderHash: "b1", side: "buy", price: 99.9, quantity: 10, executedAt: T0 + 10_000 }),
      fill({ id: "tx2:0", orderHash: "a1", side: "sell", price: 100.1, quantity: 10, executedAt: T0 + 20_000 }),
      fill({ id: "tx3:0", orderHash: "a1", side: "sell", price: 100.1, quantity: 1, executedAt: T0 + 21_000 }),
    ];
    const m = run({ orders: twoSided, fills, book, excludedFillIds: new Set(["tx3:0"]) });
    // buy at 99.9, mid at t+60 (t0+70s) = 100.5: +6.0. sell at 100.1, mid at t0+80s = 100.5: -4.0.
    expect(m.markoutUsd).toBeCloseTo(2, 9);
    expect(m.markoutNotionalUsd).toBeCloseTo(999 + 1_001, 9);
    expect(m.markoutFills).toBe(2);
  });

  it("ignores fills outside the epoch window for markout", () => {
    const fills = [fill({ id: "old:0", orderHash: "b1", side: "buy", price: 99.9, quantity: 1, executedAt: T0 - 500 })];
    const m = run({ orders: twoSided, fills });
    expect(m.markoutFills).toBe(0);
  });

  it("reports market spread with the agent present against the baseline", () => {
    const m = run({ orders: twoSided, baselineSpreadBps: 30 });
    expect(m.marketSpreadWithAgentBps).toBeCloseTo(4, 9);
    expect(m.spreadImprovementBps).toBeCloseTo(26, 9);
    expect(run({ orders: twoSided }).spreadImprovementBps).toBeNull();
  });
});

describe("aggregateAgentMetrics", () => {
  const base: MarketMetrics = {
    marketId: MKT,
    totalSamples: 12,
    validSamples: 12,
    twoSidedSamples: 12,
    uptimeSamples: 12,
    quotedSpreadBps: 20,
    depthUsd25: 2_000,
    bookShare: 0.2,
    markoutUsd: 2,
    markoutNotionalUsd: 2_000,
    markoutFills: 2,
    marketSpreadWithAgentBps: 4,
    spreadImprovementBps: 26,
  };

  it("sums depth, weights spread by two-sided samples and uptime by valid samples", () => {
    const other: MarketMetrics = {
      ...base,
      marketId: "0x" + "22".repeat(32),
      twoSidedSamples: 4,
      uptimeSamples: 3,
      quotedSpreadBps: 40,
      depthUsd25: 500,
      bookShare: 0.1,
      markoutUsd: -1,
      markoutNotionalUsd: 1_000,
      spreadImprovementBps: 10,
    };
    const a = aggregateAgentMetrics([base, other], { pnlUsd: 12.5, maxDrawdownUsd: 3 });
    expect(a.depthUsd25).toBe(2_500);
    expect(a.quotedSpreadBps).toBeCloseTo((20 * 12 + 40 * 4) / 16, 9);
    expect(a.uptimeBps).toBe(Math.round((10_000 * 15) / 24));
    expect(a.bookShare).toBeCloseTo((0.2 * 12 + 0.1 * 12) / 24, 9);
    expect(a.markout60s).toBeCloseTo((1 / 3_000) * 10_000, 9);
    expect(a.spreadImprovementBps).toBeCloseTo((26 * 12 + 10 * 4) / 16, 9);
    expect(a.pnlUsd).toBe(12.5);
    expect(a.maxDrawdownUsd).toBe(3);
    expect(a.samples).toBe(24);
    expect(a.twoSidedSamples).toBe(16);
    expect(a.coverage).toBe(1);
  });

  it("reports zero spread and zero markout when the agent never quoted or filled", () => {
    const idle: MarketMetrics = {
      ...base,
      twoSidedSamples: 0,
      uptimeSamples: 0,
      quotedSpreadBps: null,
      depthUsd25: 0,
      bookShare: 0,
      markoutUsd: 0,
      markoutNotionalUsd: 0,
      markoutFills: 0,
      marketSpreadWithAgentBps: null,
      spreadImprovementBps: null,
    };
    const a = aggregateAgentMetrics([idle], { pnlUsd: 0, maxDrawdownUsd: 0 });
    expect(a.quotedSpreadBps).toBe(0);
    expect(a.twoSidedSamples).toBe(0);
    expect(a.markout60s).toBe(0);
    expect(a.spreadImprovementBps).toBe(0);
    expect(a.uptimeBps).toBe(0);
  });

  it("reports zero coverage when there are no markets", () => {
    const a = aggregateAgentMetrics([], { pnlUsd: 0, maxDrawdownUsd: 0 });
    expect(a.coverage).toBe(0);
    expect(a.samples).toBe(0);
  });
});
