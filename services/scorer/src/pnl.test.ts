import { describe, expect, it } from "vitest";
import { computePnl } from "./pnl.js";
import type { FillRecord, FundingRecord, MarkPoint } from "./model.js";

const A = "0x" + "aa".repeat(32);
const B = "0x" + "bb".repeat(32);

function fill(p: Partial<FillRecord> & Pick<FillRecord, "id" | "side" | "price" | "quantity" | "executedAt">): FillRecord {
  return { agentId: 1, marketId: A, orderHash: "o", feeUsd: 0, isMaker: true, counterpartySubaccountId: null, ...p };
}

const marks = (market: string, pts: [number, number][]): [string, MarkPoint[]] => [market, pts.map(([at, mid]) => ({ at, mid }))];

describe("computePnl", () => {
  it("is zero with no activity", () => {
    expect(computePnl({ fills: [], funding: [], marks: new Map(), untilMs: 100 })).toEqual({ pnlUsd: 0, maxDrawdownUsd: 0 });
  });

  it("marks an open position to the latest mid and charges fees", () => {
    const r = computePnl({
      fills: [fill({ id: "1", side: "buy", price: 100, quantity: 2, feeUsd: 0.1, executedAt: 10 })],
      funding: [],
      marks: new Map([marks(A, [[0, 100], [20, 101], [30, 99.5]])]),
      untilMs: 40,
    });
    expect(r.pnlUsd).toBeCloseTo(-1.1, 9);
    // equity path: 0, -0.1 (after fee), +1.9 (mark 101), -1.1 (mark 99.5). Peak 1.9, trough -1.1.
    expect(r.maxDrawdownUsd).toBeCloseTo(3, 9);
  });

  it("realizes PnL on a round trip and counts rebates and funding", () => {
    const r = computePnl({
      fills: [
        fill({ id: "1", side: "buy", price: 100, quantity: 1, feeUsd: -0.01, executedAt: 10 }),
        fill({ id: "2", side: "sell", price: 100.5, quantity: 1, feeUsd: -0.01, executedAt: 20 }),
      ],
      funding: [{ agentId: 1, marketId: A, amountUsd: -0.05, at: 15 } satisfies FundingRecord],
      marks: new Map([marks(A, [[0, 100]])]),
      untilMs: 30,
    });
    expect(r.pnlUsd).toBeCloseTo(0.5 + 0.02 - 0.05, 9);
  });

  it("combines markets into one equity curve", () => {
    const r = computePnl({
      fills: [
        fill({ id: "1", side: "buy", price: 10, quantity: 1, executedAt: 1 }),
        fill({ id: "2", marketId: B, side: "sell", price: 50, quantity: 1, executedAt: 1 }),
      ],
      funding: [],
      marks: new Map([marks(A, [[5, 12]]), marks(B, [[5, 51]])]),
      untilMs: 10,
    });
    expect(r.pnlUsd).toBeCloseTo(2 - 1, 9);
  });

  it("ignores events after untilMs", () => {
    const r = computePnl({
      fills: [fill({ id: "1", side: "buy", price: 100, quantity: 1, executedAt: 50 })],
      funding: [],
      marks: new Map([marks(A, [[0, 100], [60, 90]])]),
      untilMs: 40,
    });
    expect(r).toEqual({ pnlUsd: 0, maxDrawdownUsd: 0 });
  });

  it("uses the fill price as the mark until a mid arrives", () => {
    const r = computePnl({
      fills: [fill({ id: "1", side: "sell", price: 100, quantity: 3, executedAt: 5 })],
      funding: [],
      marks: new Map(),
      untilMs: 10,
    });
    expect(r.pnlUsd).toBe(0);
  });
});
