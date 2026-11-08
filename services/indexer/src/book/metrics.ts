/**
 * Book metrics for one derivative orderbook sample (PRD 10.2, 10.4).
 *
 * Units: the Indexer returns derivative prices in chain format, x * 10^quoteDecimals, and
 * quantities already in human base units. Same convention as sdk-ts
 * `derivativePriceFromChainPrice` / `derivativeQuantityFromChainQuantity`
 * (@injectivelabs/sdk-ts utils) and the injective-trading-market-data skill note on tick sizes.
 * Quote assets on arena markets are USDC/USDT; notional is reported as USD 1:1 with the quote.
 */
import type { BookLevel } from "@strata/sdk";
import { fromFixed18, mulFixed, shiftDown, toFixed18, toNumber } from "../lib/decimal.js";

export interface ChainLevel {
  price: string;
  quantity: string;
}

export interface BookMetricsOptions {
  /** Depth band half-width in bps around mid. PRD: 25. */
  depthBandBps?: number;
  /** Top-of-book levels kept per side in the stored snapshot. Keeps rows small (Neon free tier). */
  maxStoredLevels?: number;
  /** STRATA agent resting quantity by human price string, per side. */
  strataBids?: ReadonlyMap<string, string>;
  strataAsks?: ReadonlyMap<string, string>;
}

export interface BookMetrics {
  mid: string | null;
  spreadBps: number | null;
  depthUsd25: number;
  strataDepthUsd25: number;
  bestBid: string | null;
  bestAsk: string | null;
  bids: BookLevel[];
  asks: BookLevel[];
}

interface Level {
  price: bigint;
  quantity: bigint;
  strata: bigint;
}

const BPS = 10_000n;

function normalize(levels: readonly ChainLevel[], quoteDecimals: number, strata: ReadonlyMap<string, string> | undefined): Level[] {
  const out: Level[] = [];
  for (const l of levels) {
    const price = shiftDown(toFixed18(l.price), quoteDecimals);
    const quantity = toFixed18(l.quantity);
    if (price <= 0n || quantity <= 0n) continue;
    const s = strata?.get(fromFixed18(price));
    const strataQty = s === undefined ? 0n : toFixed18(s);
    out.push({ price, quantity, strata: strataQty > quantity ? quantity : strataQty });
  }
  return out;
}

function toBookLevel(l: Level): BookLevel {
  return { price: fromFixed18(l.price), quantity: fromFixed18(l.quantity), strataQuantity: fromFixed18(l.strata) };
}

export function computeBookMetrics(
  book: { buys: readonly ChainLevel[]; sells: readonly ChainLevel[] },
  quoteDecimals: number,
  opts: BookMetricsOptions = {},
): BookMetrics {
  const band = BigInt(opts.depthBandBps ?? 25);
  const maxLevels = opts.maxStoredLevels ?? 10;
  const bids = normalize(book.buys, quoteDecimals, opts.strataBids).sort((a, b) => (a.price > b.price ? -1 : a.price < b.price ? 1 : 0));
  const asks = normalize(book.sells, quoteDecimals, opts.strataAsks).sort((a, b) => (a.price < b.price ? -1 : a.price > b.price ? 1 : 0));
  const bestBid = bids[0];
  const bestAsk = asks[0];

  if (!bestBid || !bestAsk) {
    // One-sided or empty book: there is no mid, so no spread and no band depth. Stored as such.
    return {
      mid: null,
      spreadBps: null,
      depthUsd25: 0,
      strataDepthUsd25: 0,
      bestBid: bestBid ? fromFixed18(bestBid.price) : null,
      bestAsk: bestAsk ? fromFixed18(bestAsk.price) : null,
      bids: bids.slice(0, maxLevels).map(toBookLevel),
      asks: asks.slice(0, maxLevels).map(toBookLevel),
    };
  }

  const mid = (bestBid.price + bestAsk.price) / 2n;
  const spread = bestAsk.price - bestBid.price;
  const spreadBps = spread >= 0n ? toNumber((spread * BPS * 10n ** 18n) / mid) : null;

  const lo = mid - (mid * band) / BPS;
  const hi = mid + (mid * band) / BPS;
  let depth = 0n;
  let strataDepth = 0n;
  for (const l of bids) {
    if (l.price < lo) break;
    depth += mulFixed(l.price, l.quantity);
    strataDepth += mulFixed(l.price, l.strata);
  }
  for (const l of asks) {
    if (l.price > hi) break;
    depth += mulFixed(l.price, l.quantity);
    strataDepth += mulFixed(l.price, l.strata);
  }

  return {
    mid: fromFixed18(mid),
    spreadBps,
    depthUsd25: toNumber(depth),
    strataDepthUsd25: toNumber(strataDepth),
    bestBid: fromFixed18(bestBid.price),
    bestAsk: fromFixed18(bestAsk.price),
    bids: bids.slice(0, maxLevels).map(toBookLevel),
    asks: asks.slice(0, maxLevels).map(toBookLevel),
  };
}
