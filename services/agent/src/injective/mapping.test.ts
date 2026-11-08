import { describe, expect, it } from "vitest";
import { getMarkets } from "@strata/config";
import { fillFromTrade, positionView } from "./mapping.js";
import { toAdapterOptions } from "./adapter.js";

describe("positionView", () => {
  it("is flat with a null margin ratio when there is no position", () => {
    expect(positionView(null, "100", "0.05")).toEqual({ position: { quantity: "0", entryPrice: null, margin: "0", unrealizedPnl: "0" }, marginRatio: null });
  });

  it("computes signed quantity, uPnL and margin ratio for a short", () => {
    const v = positionView({ isLong: false, quantity: "2", entryPrice: "100", margin: "20" }, "90", "0.05");
    expect(v.position.quantity).toBe("-2");
    expect(v.position.unrealizedPnl).toBe("20");
    // equity 40 / maintenance 2*90*0.05 = 9
    expect(v.marginRatio).toBeCloseTo(40 / 9, 10);
  });

  it("never returns a null ratio while a position is open, even with no mark price", () => {
    const noMark = positionView({ isLong: true, quantity: "1", entryPrice: "50", margin: "5" }, null, "0.05");
    expect(noMark.marginRatio).toBeCloseTo(5 / 2.5, 10);
    const zeroMark = positionView({ isLong: true, quantity: "1", entryPrice: "50", margin: "5" }, "0", "0.05");
    expect(zeroMark.marginRatio).not.toBeNull();
    const zeroMaint = positionView({ isLong: true, quantity: "1", entryPrice: "50", margin: "5" }, "50", "0");
    expect(zeroMaint.marginRatio).toBe(Number.MAX_SAFE_INTEGER);
  });
});

describe("fillFromTrade", () => {
  it("keys the fill on the trade ID and scales Indexer v1 price and fee", () => {
    const f = fillFromTrade(
      {
        tradeId: "147700123_7",
        marketId: `0x${"b".repeat(64)}`,
        orderHash: "0xorder",
        tradeDirection: "sell",
        executionPrice: "4054000",
        executionQuantity: "0.38",
        fee: "1500",
        executionSide: "maker",
        executedAt: 1_794_200_000_000,
        subaccountId: `0x${"c".repeat(64)}`,
      },
      { quoteDecimals: 6 },
    );
    expect(f).toMatchObject({ tradeId: "147700123_7", txHash: "147700123_7", eventIndex: 7, side: "sell", price: "4.054", quantity: "0.38", fee: "0.0015", isMaker: true });
  });
});

describe("toAdapterOptions", () => {
  const markets = getMarkets("testnet").filter((m) => m.arenaEnabled).slice(0, 2);

  it("maps the core options to the agent's own keystore and default subaccount", () => {
    const o = toAdapterOptions({ network: "testnet", agentName: "strata-test-1", markets, secretsDir: "/tmp/none" });
    expect(o.keyName).toBe("strata-test-1");
    expect(o.subaccountIndex).toBe(0);
    expect(o.granter).toBeUndefined();
    expect(o.marketIds).toEqual(markets.map((m) => m.marketId));
  });

  it("refuses markets from another network and an empty market list", () => {
    expect(() => toAdapterOptions({ network: "mainnet", agentName: "x", markets, secretsDir: "/tmp" })).toThrow(/testnet/);
    expect(() => toAdapterOptions({ network: "testnet", agentName: "x", markets: [], secretsDir: "/tmp" })).toThrow(/no markets/);
  });
});
