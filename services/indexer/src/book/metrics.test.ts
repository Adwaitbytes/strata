import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computeBookMetrics } from "./metrics.js";

const fixture = JSON.parse(readFileSync(new URL("../../test/fixtures/orderbook.mainnet.doge.json", import.meta.url), "utf8")) as {
  market: { quoteDecimals: number };
  orderbook: { buys: { price: string; quantity: string }[]; sells: { price: string; quantity: string }[] };
};

describe("computeBookMetrics (recorded mainnet DOGE book)", () => {
  const m = computeBookMetrics(fixture.orderbook, fixture.market.quoteDecimals);

  it("converts chain prices to human prices and computes mid", () => {
    expect(m.bestBid).toBe("0.0712");
    expect(m.bestAsk).toBe("0.0715");
    expect(m.mid).toBe("0.07135");
  });
  it("computes spread in bps", () => {
    expect(m.spreadBps).toBeCloseTo((0.0003 / 0.07135) * 10_000, 6);
  });
  it("sums USD notional within 25 bps of mid on both sides", () => {
    expect(m.depthUsd25).toBeCloseTo(0.0712 * 13465 + 0.0715 * 70808, 6);
    expect(m.strataDepthUsd25).toBe(0);
  });
  it("stores human-unit levels with zero STRATA quantity", () => {
    expect(m.bids[0]).toEqual({ price: "0.0712", quantity: "13465", strataQuantity: "0" });
    expect(m.asks.length).toBe(fixture.orderbook.sells.length);
  });
});

describe("computeBookMetrics edge cases", () => {
  it("returns null mid and zero depth for a one-sided book", () => {
    const m = computeBookMetrics({ buys: [{ price: "1000000", quantity: "1" }], sells: [] }, 6);
    expect(m.mid).toBeNull();
    expect(m.spreadBps).toBeNull();
    expect(m.depthUsd25).toBe(0);
    expect(m.bestBid).toBe("1");
  });
  it("sorts unsorted input and caps stored levels", () => {
    const buys = Array.from({ length: 15 }, (_, i) => ({ price: String(100_000_000 - i * 10_000), quantity: "1" }));
    const m = computeBookMetrics({ buys: [...buys].reverse(), sells: [{ price: "100010000", quantity: "2" }] }, 6, { maxStoredLevels: 5 });
    expect(m.bestBid).toBe("100");
    expect(m.bids).toHaveLength(5);
    expect(m.mid).toBe("100.005");
  });
  it("attributes STRATA depth from agent resting quantity", () => {
    const m = computeBookMetrics(
      { buys: [{ price: "99990000", quantity: "3" }], sells: [{ price: "100010000", quantity: "2" }] },
      6,
      { strataBids: new Map([["99.99", "1"]]), strataAsks: new Map([["100.01", "5"]]) },
    );
    expect(m.strataDepthUsd25).toBeCloseTo(99.99 + 100.01 * 2, 6);
    expect(m.asks[0]?.strataQuantity).toBe("2");
  });
  it("handles exponent notation from the indexer", () => {
    const m = computeBookMetrics({ buys: [{ price: "1e6", quantity: "1.5e-1" }], sells: [{ price: "1000100", quantity: "1" }] }, 6);
    expect(m.bids[0]?.quantity).toBe("0.15");
  });
});
