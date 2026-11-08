import { OrderType } from "@injectivelabs/core-proto-ts-v2/generated/injective/exchange/v2/order_pb";
import { BatchUpdateOrdersAuthz } from "@injectivelabs/core-proto-ts-v2/generated/injective/exchange/v2/authz_pb";
import { TxMsgData } from "@injectivelabs/core-proto-ts-v2/generated/cosmos/base/abci/v1beta1/abci_pb";
import { MsgExecResponse } from "@injectivelabs/core-proto-ts-v2/generated/cosmos/authz/v1beta1/tx_pb";
import { MsgBatchUpdateOrdersResponse } from "@injectivelabs/core-proto-ts-v2/generated/injective/exchange/v2/tx_pb";
import { describe, expect, it } from "vitest";
import { BATCH_UPDATE_ORDERS_AUTHZ_TYPE, buildTradingGrant, encodeBatchUpdateOrdersAuthz } from "./authz.js";
import { decodeBatchResponse, BATCH_UPDATE_RESPONSE_TYPE, EXEC_RESPONSE_TYPE } from "./decode.js";
import { buildLimitOrder, closeOrder, orderTypeFor } from "./orders.js";
import type { MarketSpec } from "./orders.js";

// Live testnet INJ/USDC PERP params (packages/config/src/generated/markets.testnet.json, fetched 2026-11-09).
const INJ: MarketSpec = {
  marketId: "0xdc70164d7120529c3cd84278c98df4151210c0447a65a2aab03459cf328de41e",
  ticker: "INJ/USDC PERP",
  minPriceTickSize: "0.001",
  minQuantityTickSize: "0.01",
  minNotional: "1",
  initialMarginRatio: "0.033333",
  quoteDecimals: 6,
  quoteDenom: "erc20:0x0C382e685bbeeFE5d3d9C29e29E341fEE8E84C5d",
};
const FEE = "inj15dlcgkplx4hvatfpy3cmfx2ykd2xnmv28q3pdh";

describe("orderTypeFor", () => {
  it("maps side and post-only to the v2 proto enum", () => {
    expect(orderTypeFor("buy", true)).toBe(OrderType.BUY_PO);
    expect(orderTypeFor("sell", true)).toBe(OrderType.SELL_PO);
    expect(orderTypeFor("buy", false)).toBe(OrderType.BUY);
    expect(OrderType.BUY_PO).toBe(7);
    expect(OrderType.SELL_PO).toBe(8);
  });
});

describe("buildLimitOrder", () => {
  const base = { side: "buy" as const, price: "8.1234", quantity: "0.555", postOnly: true, reduceOnly: false, cid: "c1" };

  it("snaps buys down and sells up to the price tick, quantity down to the qty tick", () => {
    const buy = buildLimitOrder(INJ, base, { markPrice: "8.1", feeRecipient: FEE });
    expect(buy).toMatchObject({ ok: true, order: { price: "8.123", quantity: "0.55", orderType: OrderType.BUY_PO, feeRecipient: FEE, cid: "c1" } });
    const sell = buildLimitOrder(INJ, { ...base, side: "sell" }, { markPrice: "8.1", feeRecipient: FEE });
    expect(sell).toMatchObject({ ok: true, order: { price: "8.124", orderType: OrderType.SELL_PO } });
  });

  it("buffers margin against the higher of order and mark price", () => {
    const r = buildLimitOrder(INJ, base, { markPrice: "9", feeRecipient: FEE });
    // 9 * 0.55 * 0.033333 * 1.02 = 0.168296... rounded up to 6 dp
    expect(r.ok && r.order.margin).toBe("0.168299");
  });

  it("reduce-only orders carry zero margin", () => {
    const r = buildLimitOrder(INJ, { ...base, reduceOnly: true }, { markPrice: "9", feeRecipient: FEE });
    expect(r.ok && r.order.margin).toBe("0");
  });

  it("rejects below min notional, sub-tick size and bad cids without touching the chain", () => {
    expect(buildLimitOrder(INJ, { ...base, quantity: "0.1" }, { markPrice: null, feeRecipient: FEE })).toMatchObject({ ok: false, reason: expect.stringMatching(/below min/) });
    expect(buildLimitOrder(INJ, { ...base, quantity: "0.009" }, { markPrice: null, feeRecipient: FEE })).toMatchObject({ ok: false, reason: expect.stringMatching(/quantity below tick/) });
    expect(buildLimitOrder(INJ, { ...base, cid: "has space" }, { markPrice: null, feeRecipient: FEE })).toMatchObject({ ok: false });
    expect(buildLimitOrder(INJ, { ...base, cid: "x".repeat(37) }, { markPrice: null, feeRecipient: FEE })).toMatchObject({ ok: false });
    expect(buildLimitOrder(INJ, { ...base, price: "0" }, { markPrice: null, feeRecipient: FEE })).toMatchObject({ ok: false });
  });
});

describe("closeOrder", () => {
  it("closes a long with a reduce-only sell 1% under mark", () => {
    const o = closeOrder(INJ, { positionQty: "1.237", isLong: true, markPrice: "8", feeRecipient: FEE, cid: "close" });
    expect(o).toMatchObject({ price: "7.92", quantity: "1.23", margin: "0", orderType: OrderType.SELL });
  });
  it("closes a short with a buy 1% over mark and ignores dust", () => {
    expect(closeOrder(INJ, { positionQty: "2", isLong: false, markPrice: "8", feeRecipient: FEE, cid: "c" })).toMatchObject({ price: "8.08", orderType: OrderType.BUY });
    expect(closeOrder(INJ, { positionQty: "0.001", isLong: false, markPrice: "8", feeRecipient: FEE, cid: "c" })).toBeNull();
  });
});

describe("authz grant encoding", () => {
  const sub = "0x4ce919b19d7afc0e92ec0e52f05aabbf73e28a13000000000000000000000000";
  it("encodes BatchUpdateOrdersAuthz scoped to one subaccount and the given markets only", () => {
    const any = encodeBatchUpdateOrdersAuthz(sub, [INJ.marketId]);
    expect(any.typeUrl).toBe(BATCH_UPDATE_ORDERS_AUTHZ_TYPE);
    const back = BatchUpdateOrdersAuthz.fromBinary(any.value);
    expect(back).toEqual({ subaccountId: sub, spotMarkets: [], derivativeMarkets: [INJ.marketId] });
  });
  it("refuses a subaccount the granter does not own and self grants", () => {
    expect(() =>
      buildTradingGrant({ granter: FEE, grantee: "inj1wxtyzazhp85x0wc2erge29dmey4ns47kghnt5t", subaccountId: sub, derivativeMarketIds: [INJ.marketId] }),
    ).toThrow(/belong to the granter/);
    expect(() => buildTradingGrant({ granter: FEE, grantee: FEE, subaccountId: sub, derivativeMarketIds: [INJ.marketId] })).toThrow(/differ/);
    expect(() => encodeBatchUpdateOrdersAuthz(sub, [])).toThrow();
  });
});

describe("decodeBatchResponse", () => {
  const inner = MsgBatchUpdateOrdersResponse.create({
    derivativeOrderHashes: ["0xabc"],
    createdDerivativeOrdersCids: ["c1"],
    failedDerivativeOrdersCids: ["c2"],
    derivativeCancelSuccess: [true],
  });
  const innerBytes = MsgBatchUpdateOrdersResponse.toBinary(inner);

  it("reads a direct MsgBatchUpdateOrdersResponse from hex TxMsgData", () => {
    const data = TxMsgData.toBinary({ data: [], msgResponses: [{ typeUrl: BATCH_UPDATE_RESPONSE_TYPE, value: innerBytes }] });
    const r = decodeBatchResponse(Buffer.from(data).toString("hex"));
    expect(r).toMatchObject({ derivativeOrderHashes: ["0xabc"], failedDerivativeOrdersCids: ["c2"] });
  });

  it("unwraps an authz MsgExecResponse (base64 data)", () => {
    const exec = MsgExecResponse.toBinary({ results: [innerBytes] });
    const data = TxMsgData.toBinary({ data: [], msgResponses: [{ typeUrl: EXEC_RESPONSE_TYPE, value: exec }] });
    expect(decodeBatchResponse(Buffer.from(data).toString("base64"))?.derivativeOrderHashes).toEqual(["0xabc"]);
  });

  it("returns null for empty data", () => {
    expect(decodeBatchResponse(undefined)).toBeNull();
    expect(decodeBatchResponse("")).toBeNull();
  });
});
