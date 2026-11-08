import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { computeBookMetrics } from "../book/metrics.js";
import { levelFromCid, mapOrder, mapPosition, mapTrade, strataBookMaps, tradeEventIndex } from "./mappers.js";
import { IndexerOrder, IndexerPosition, IndexerTrade } from "./records.js";

const fx = JSON.parse(readFileSync(new URL("../../test/fixtures/derivatives.mainnet.xau.json", import.meta.url), "utf8")) as {
  orders: { orders: unknown[] };
  positions: { positions: unknown[] };
  trades: { trades: unknown[] };
};
const trades = fx.trades.trades.map((t) => IndexerTrade.parse(t));
const orders = fx.orders.orders.map((o) => IndexerOrder.parse(o));
const positions = fx.positions.positions.map((p) => IndexerPosition.parse(p));

describe("mapTrade (recorded mainnet XAU trades)", () => {
  const t = trades[0]!;
  it("converts chain price and fee to human units", () => {
    const { trade, fill } = mapTrade(t, "mainnet", 6, new Map());
    expect(trade.price).toBe("3990.04");
    expect(trade.quantity).toBe("0.0004");
    expect(trade.fee).toBe("0.0000009576096");
    expect(trade.isMaker).toBe(true);
    expect(fill).toBeNull();
  });
  it("attributes fills to agents by subaccount and keys them by trade id + event index", () => {
    const { fill } = mapTrade(t, "testnet", 6, new Map([[t.subaccountId.toLowerCase(), 42]]));
    expect(fill).toMatchObject({ agentId: 42, txHash: "190908174_5", eventIndex: 5, provenance: "TESTNET", side: "sell" });
  });
  it("parses event indexes and cid levels", () => {
    expect(tradeEventIndex("190906176_3")).toBe(3);
    expect(tradeEventIndex("weird")).toBe(0);
    expect(levelFromCid("strata-atlas-L2-123")).toBe(2);
    expect(levelFromCid("tc-web-9c5c51a5")).toBe(0);
  });
});

describe("mapOrder / mapPosition (recorded mainnet XAU)", () => {
  it("maps a booked buy order", () => {
    const row = mapOrder(orders[0]!, "mainnet", 6, 1);
    expect(row).toMatchObject({ side: "buy", price: "3500", quantity: "0.2212", cancelledAt: null, provenance: "LIVE" });
    expect(row.postedAt.getTime()).toBe(1793417167634);
  });
  it("maps a position with human prices", () => {
    const row = mapPosition(positions[0]!, "mainnet", 6, 1, new Date(0));
    expect(row.entryPrice).toBe("4057.097272727272727273");
    expect(row.margin).toBe("0.499562945975");
    expect(row.direction).toBe("long");
  });
});

describe("strataBookMaps", () => {
  it("feeds STRATA depth into book metrics", () => {
    const o = orders[0]!;
    const maps = strataBookMaps([o], o.marketId, 6);
    expect(maps.bids.get("3500")).toBe("0.2212");
    const m = computeBookMetrics(
      { buys: [{ price: o.price, quantity: o.unfilledQuantity }], sells: [{ price: "3500500000", quantity: "1" }] },
      6,
      { strataBids: maps.bids, strataAsks: maps.asks },
    );
    expect(m.strataDepthUsd25).toBeCloseTo(3500 * 0.2212, 6);
  });
});
