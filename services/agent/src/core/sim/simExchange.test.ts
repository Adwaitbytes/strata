import { describe, expect, it } from "vitest";
import { SimExchange } from "./simExchange.js";

const M = `0x${"a".repeat(64)}`;
const T0 = 1_780_000_000_000;

function sim() {
  return new SimExchange({
    chainTimeMs: T0,
    markets: [{ marketId: M, bids: [{ price: "99.9", quantity: "5" }], asks: [{ price: "100.1", quantity: "5" }], oraclePrice: "100" }],
  });
}

const order = (side: "buy" | "sell", price: string, quantity = "1", cid = `${side}-${price}`) => ({
  side,
  price,
  quantity,
  postOnly: true,
  reduceOnly: false,
  cid,
});

describe("SimExchange", () => {
  it("creates, lists and cancels orders, and shows them in the aggregated book", async () => {
    const ex = sim();
    const res = await ex.batchUpdate({ marketId: M, cancelOrderHashes: [], create: [order("buy", "99.9"), order("sell", "100.3")], feeRecipient: ex.address });
    expect(res.createdOrderHashes).toHaveLength(2);
    const state = await ex.getMarketState(M);
    expect(state.bids[0]).toEqual({ price: "99.9", quantity: "6" });
    expect(state.asks.map((a) => a.price)).toEqual(["100.1", "100.3"]);
    await ex.batchUpdate({ marketId: M, cancelOrderHashes: [res.createdOrderHashes[0]!], create: [], feeRecipient: ex.address });
    expect(await ex.getOpenOrders(M)).toHaveLength(1);
    await ex.cancelAll(M);
    expect(await ex.getOpenOrders(M)).toHaveLength(0);
  });

  it("rejects post-only orders that would cross the external book", async () => {
    const ex = sim();
    const res = await ex.batchUpdate({ marketId: M, cancelOrderHashes: [], create: [order("buy", "100.1", "1", "x")], feeRecipient: ex.address });
    expect(res.rejected).toEqual([{ cid: "x", reason: "post-only order would cross" }]);
  });

  it("fills maker orders on taker trades, tracks position and pushes fill events", async () => {
    const ex = sim();
    const seen: string[] = [];
    const unsub = ex.onFill((f) => seen.push(`${f.side}:${f.quantity}@${f.price}`));
    await ex.batchUpdate({ marketId: M, cancelOrderHashes: [], create: [order("sell", "100.2", "1"), order("sell", "100.4", "2")], feeRecipient: ex.address });
    ex.takerTrade(M, "buy", "2");
    expect(seen).toEqual(["sell:1@100.2", "sell:1@100.4"]);
    expect(ex.position(M)).toBe("-2");
    await ex.batchUpdate({ marketId: M, cancelOrderHashes: [], create: [order("buy", "99.5", "3")], feeRecipient: ex.address });
    ex.takerTrade(M, "sell", "3");
    expect(ex.position(M)).toBe("1");
    const st = await ex.getMarketState(M);
    expect(st.position.entryPrice).toBe("99.5");
    unsub();
    ex.takerTrade(M, "buy", "1");
    expect(seen).toHaveLength(3);
  });

  it("closes positions reduce-only at the oracle price", async () => {
    const ex = sim();
    await ex.closePositionReduceOnly(M);
    await ex.batchUpdate({ marketId: M, cancelOrderHashes: [], create: [order("buy", "99.5", "2")], feeRecipient: ex.address });
    ex.takerTrade(M, "sell", "2");
    await ex.closePositionReduceOnly(M);
    expect(ex.position(M)).toBe("0");
  });

  it("injects faults: throw, apply_then_throw and land_later", async () => {
    const ex = sim();
    const upd = { marketId: M, cancelOrderHashes: [], create: [order("buy", "99")], feeRecipient: ex.address };
    ex.injectFault("batchUpdate", "throw");
    await expect(ex.batchUpdate(upd)).rejects.toThrow(/injected throw/);
    expect(ex.openOrders(M)).toHaveLength(0);

    ex.injectFault("batchUpdate", "apply_then_throw");
    await expect(ex.batchUpdate(upd)).rejects.toThrow(/apply_then_throw/);
    expect(ex.openOrders(M)).toHaveLength(1);

    ex.injectFault("batchUpdate", "land_later", 3_000);
    await expect(ex.batchUpdate(upd)).rejects.toThrow(/land_later/);
    expect(ex.pendingCount).toBe(1);
    ex.advance(2_000);
    expect(ex.openOrders(M)).toHaveLength(1);
    ex.advance(1_000);
    expect(ex.openOrders(M)).toHaveLength(2);

    ex.injectFault("getMarketState", "throw");
    await expect(ex.getMarketState(M)).rejects.toThrow();
    ex.injectFault("getOpenOrders", "throw");
    await expect(ex.getOpenOrders(M)).rejects.toThrow();
    ex.injectFault("cancelAll", "throw");
    await expect(ex.cancelAll(M)).rejects.toThrow();
    ex.injectFault("closePositionReduceOnly", "throw");
    await expect(ex.closePositionReduceOnly(M)).rejects.toThrow();
    expect(() => ex.setOracle("0xnope", "1")).toThrow(/unknown market/);
  });

  it("scripts oracle, reference and book", async () => {
    const ex = sim();
    ex.setOracle(M, "101", T0 - 5_000);
    ex.setReference(M, { price: "101.1", timestampMs: T0, source: "ref" });
    ex.setBook(M, [], []);
    ex.marginRatio = 2;
    const st = await ex.getMarketState(M);
    expect(st.oracle).toMatchObject({ price: "101", timestampMs: T0 - 5_000 });
    expect(st.reference?.price).toBe("101.1");
    expect(st.bids).toEqual([]);
    expect(st.marginRatio).toBe(2);
    ex.setReference(M, null);
    expect((await ex.getMarketState(M)).reference).toBeNull();
  });
});
