import type { Quote } from "@strata/sdk";
import { describe, expect, it } from "vitest";
import { buildQuoteLadders } from "./quote-ladders";

const BTC = `0x${"b".repeat(64)}`;
const ETH = `0x${"e".repeat(64)}`;

const quote = (marketId: string, side: "buy" | "sell", price: string, level = 0, cancelledAt: number | null = null): Quote => ({
  network: "testnet",
  provenance: "TESTNET",
  agentId: 1,
  marketId,
  orderHash: `${marketId}-${side}-${price}`,
  side,
  price,
  quantity: "1",
  level,
  postedAt: 1,
  cancelledAt,
});

describe("buildQuoteLadders", () => {
  it("never computes a spread across markets far apart in price", () => {
    const ladders = buildQuoteLadders(
      [quote(BTC, "buy", "76000"), quote(BTC, "sell", "76020"), quote(ETH, "buy", "2999"), quote(ETH, "sell", "3001")],
      new Map([
        [BTC, "BTC/USDT PERP"],
        [ETH, "ETH/USDT PERP"],
      ]),
    );
    expect(ladders.map((l) => l.ticker)).toEqual(["BTC/USDT PERP", "ETH/USDT PERP"]);
    const [btc, eth] = ladders;
    expect(btc?.mid).toBe(76010);
    expect(btc?.spreadBps).toBeCloseTo((20 / 76010) * 10_000, 6);
    expect(eth?.mid).toBe(3000);
    expect(eth?.spreadBps).toBeCloseTo((2 / 3000) * 10_000, 6);
    for (const l of ladders) expect(l.spreadBps).toBeGreaterThan(0);
  });

  it("drops cancelled orders, leaves the ticker null when unknown, and has no mid for a one-sided book", () => {
    const [only] = buildQuoteLadders([quote(BTC, "buy", "100"), quote(BTC, "sell", "101", 0, 5)], new Map());
    expect(only?.ticker).toBeNull();
    expect(only?.quotes).toHaveLength(1);
    expect(only?.mid).toBeNull();
    expect(only?.spreadBps).toBeNull();
  });

  it("returns no ladders when nothing is resting", () => {
    expect(buildQuoteLadders([quote(BTC, "buy", "1", 0, 9)], new Map())).toEqual([]);
  });
});
