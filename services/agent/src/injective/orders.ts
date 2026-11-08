/**
 * Pure order construction: tick snapping, min-notional checks, margin and order type for
 * `MsgBatchUpdateOrdersV2` (human units, see units.ts). No I/O, fully unit tested.
 */
import { OrderType } from "@injectivelabs/core-proto-ts-v2/generated/injective/exchange/v2/order_pb";
import type { Market } from "@strata/sdk";
import type { NewOrder } from "../core/exchange.js";
import { dec, notional, orderMargin, plain, quantize } from "./units.js";

export type MarketSpec = Pick<
  Market,
  "marketId" | "minPriceTickSize" | "minQuantityTickSize" | "minNotional" | "initialMarginRatio" | "quoteDecimals" | "quoteDenom" | "ticker"
>;

export interface DerivativeOrderParams {
  marketId: string;
  orderType: OrderType;
  feeRecipient: string;
  price: string;
  quantity: string;
  margin: string;
  cid: string;
}

export type BuildResult = { ok: true; order: DerivativeOrderParams } | { ok: false; cid: string; reason: string };

/** Injective accepts UUID cids (36 chars) as seen in live mainnet trades; keep to that charset and length. */
const CID = /^[A-Za-z0-9_-]{1,36}$/;

export function orderTypeFor(side: "buy" | "sell", postOnly: boolean): OrderType {
  if (side === "buy") return postOnly ? OrderType.BUY_PO : OrderType.BUY;
  return postOnly ? OrderType.SELL_PO : OrderType.SELL;
}

export function buildLimitOrder(spec: MarketSpec, order: NewOrder, ctx: { markPrice: string | null; feeRecipient: string }): BuildResult {
  if (!CID.test(order.cid)) return { ok: false, cid: order.cid, reason: "cid must be 1 to 36 chars of [A-Za-z0-9_-]" };
  if (!(dec(order.price).gt(0) && dec(order.quantity).gt(0))) return { ok: false, cid: order.cid, reason: "price and quantity must be positive" };

  // Snap away from the touch so a post-only order never crosses because of rounding.
  const price = quantize(order.price, spec.minPriceTickSize, order.side === "buy" ? "down" : "up");
  const quantity = quantize(order.quantity, spec.minQuantityTickSize, "down");
  if (dec(price).lte(0)) return { ok: false, cid: order.cid, reason: `price below tick ${spec.minPriceTickSize}` };
  if (dec(quantity).lte(0)) return { ok: false, cid: order.cid, reason: `quantity below tick ${spec.minQuantityTickSize}` };
  if (dec(notional(price, quantity)).lt(spec.minNotional)) {
    return { ok: false, cid: order.cid, reason: `notional ${notional(price, quantity)} below min ${plain(dec(spec.minNotional))}` };
  }

  // Reduce-only orders carry zero margin on Injective (injective-mcp-servers skill, "Close Orders").
  const margin = order.reduceOnly
    ? "0"
    : orderMargin({ price, quantity, markPrice: ctx.markPrice, initialMarginRatio: spec.initialMarginRatio, quoteDecimals: spec.quoteDecimals });

  return {
    ok: true,
    order: {
      marketId: spec.marketId,
      orderType: orderTypeFor(order.side, order.postOnly),
      feeRecipient: ctx.feeRecipient,
      price,
      quantity,
      margin,
      cid: order.cid,
    },
  };
}

/** Worst acceptable price for a reduce-only market close: 1% through mark (skill: 5% can trip bankruptcy price checks). */
export const CLOSE_SLIPPAGE = "0.01";

export function closeOrder(spec: MarketSpec, args: { positionQty: string; isLong: boolean; markPrice: string; feeRecipient: string; cid: string }): DerivativeOrderParams | null {
  const qty = quantize(dec(args.positionQty).abs().toFixed(), spec.minQuantityTickSize, "down");
  if (dec(qty).lte(0)) return null;
  const side = args.isLong ? "sell" : "buy";
  const factor = side === "sell" ? dec(1).minus(CLOSE_SLIPPAGE) : dec(1).plus(CLOSE_SLIPPAGE);
  const price = quantize(plain(dec(args.markPrice).mul(factor)), spec.minPriceTickSize, side === "sell" ? "down" : "up");
  return { marketId: spec.marketId, orderType: orderTypeFor(side, false), feeRecipient: args.feeRecipient, price, quantity: qty, margin: "0", cid: args.cid };
}
