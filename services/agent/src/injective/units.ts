/**
 * Unit handling for Injective exchange v2.
 *
 * Facts this relies on (verified live on 2026-11-09, both networks):
 *  - Chain v2 market params (`/injective/exchange/v2/derivative/markets`) are human-readable
 *    decimals, e.g. DOGE/USDC min_price_tick_size "0.0001", min_notional "1".
 *  - The Indexer v1 market list reports the same price tick and min notional in chain format
 *    (scaled by 10^quoteDecimals: 100 and 1000000), while minQuantityTickSize is already human
 *    (injective-trading-market-data skill, "minPriceTickSize from the indexer is in chain format").
 *  - `MsgBatchUpdateOrdersV2` (`/injective.exchange.v2.MsgBatchUpdateOrders`) takes human price,
 *    quantity and margin and applies the 10^18 Dec encoding itself (sdk-ts `toChainFormat`).
 *    So no quote-decimal scaling is applied to v2 order fields. The older v1beta1 message expected
 *    price x 10^quoteDecimals (injective-mcp-servers skill, "SDK fromJSON Scaling"); we do not use it.
 *  - Oracle and other cosmos `Dec` values over gRPC are integers scaled by 10^18.
 */
import { Decimal } from "decimal.js";

const D = Decimal.clone({ precision: 60, rounding: Decimal.ROUND_HALF_EVEN, toExpNeg: -40, toExpPos: 60 });
export type Dec = InstanceType<typeof D>;

export function dec(value: string | number | Dec): Dec {
  return new D(value);
}

/** Plain decimal string without exponent or trailing zeros. */
export function plain(value: Dec): string {
  return value.toFixed();
}

/** cosmos Dec integer string (10^18 scale) to a human decimal string. */
export function decFromChain(raw: string): string {
  return plain(dec(raw).div(dec(10).pow(18)));
}

/** Indexer chain-format value to human: divide by 10^decimals. */
export function scaleDown(raw: string | number, decimals: number): string {
  return plain(dec(raw).div(dec(10).pow(decimals)));
}

export type RoundMode = "down" | "up" | "nearest";

/** Snap `value` onto a multiple of `tick`. */
export function quantize(value: string, tick: string, mode: RoundMode): string {
  const t = dec(tick);
  if (t.lte(0)) throw new Error(`tick must be positive, got ${tick}`);
  const ratio = dec(value).div(t);
  const steps = mode === "down" ? ratio.floor() : mode === "up" ? ratio.ceil() : ratio.toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN);
  return plain(steps.mul(t));
}

export function isMultipleOf(value: string, tick: string): boolean {
  return dec(value).mod(dec(tick)).isZero();
}

/** Default margin buffer over the exact minimum: the chain can reject at the exact minimum (injective-trading-account skill). */
export const MARGIN_BUFFER = "1.02";

/**
 * Margin for a limit order: qty x max(orderPrice, markPrice) x initialMarginRatio x buffer, rounded
 * up to quote precision. Using the higher of order and mark price follows the skill note that the
 * chain validates against the higher reference price.
 */
export function orderMargin(args: {
  price: string;
  quantity: string;
  markPrice: string | null;
  initialMarginRatio: string;
  quoteDecimals: number;
  buffer?: string;
}): string {
  const ref = args.markPrice === null ? dec(args.price) : Decimal.max(dec(args.price), dec(args.markPrice));
  const raw = ref.mul(args.quantity).mul(args.initialMarginRatio).mul(args.buffer ?? MARGIN_BUFFER);
  return plain(raw.toDecimalPlaces(args.quoteDecimals, Decimal.ROUND_UP));
}

export function notional(price: string, quantity: string): string {
  return plain(dec(price).mul(quantity));
}
