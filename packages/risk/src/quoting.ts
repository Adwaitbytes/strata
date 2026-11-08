/**
 * Deterministic quoting engine (PRD 9.3). Pure functions, no I/O.
 *
 * Model: Avellaneda-Stoikov in basis-point space with a normalized inventory q (see params.ts):
 *   reservation = fair * (1 + skewBps / 1e4)
 *   skewBps     = -(q * gamma * sigma^2 * T) - capSkewBps * q^3 - fundingSkew
 *   halfSpread  = max(minHalfSpreadBps, gamma * sigma^2 * T / 2 + (1 / gamma) * ln(1 + gamma / kappa))
 * The cubic term is the nonlinear skew that grows as inventory nears the cap.
 *
 * Analytics use JS numbers; anything that reaches the chain (price, quantity) is snapped with
 * decimal.js so tick and step multiples are exact.
 */
import { Decimal } from "decimal.js";
import type { Side } from "@strata/sdk";
import type { RiskParams } from "./params.js";

export interface PriceLevel {
  readonly price: string;
  readonly quantity: string;
}

export interface OwnOrder {
  readonly side: Side;
  readonly price: string;
  /** Remaining (unfilled) quantity. */
  readonly quantity: string;
}

export interface MarketSpec {
  readonly tickSize: string;
  readonly minQuantity: string;
  readonly minNotional: string;
}

export interface SessionMultipliers {
  readonly spreadMultiplier: number;
  readonly sizeMultiplier: number;
  readonly inventoryCapMultiplier: number;
}

/**
 * normal: two-sided ladder.
 * reduce_only: ladder on the inventory-reducing side only (risk governor blocked increases).
 * flatten: one reduce-only order for the whole position close to fair (pre-close, margin breach).
 */
export type QuoteMode = "normal" | "reduce_only" | "flatten";

export interface QuoteInput {
  readonly fair: number;
  readonly sigmaBps: number;
  readonly kappa: number;
  /** Signed position in base units, positive = long. */
  readonly inventoryBase: number;
  /** Hourly funding rate as a fraction (0.0001 = 1 bp per hour), positive = longs pay. */
  readonly fundingRateHourly: number | null;
  /** Aggregated L2 book as published, including our own resting orders. */
  readonly bids: readonly PriceLevel[];
  readonly asks: readonly PriceLevel[];
  readonly ownOrders: readonly OwnOrder[];
  readonly market: MarketSpec;
  readonly session: SessionMultipliers;
  readonly mode: QuoteMode;
}

export interface QuoteLevel {
  readonly side: Side;
  readonly price: string;
  readonly quantity: string;
  readonly level: number;
  readonly reduceOnly: boolean;
}

export type DropReason = "non_positive_price" | "inventory_capacity" | "below_minimum";

export interface QuotePlan {
  readonly quotes: readonly QuoteLevel[];
  readonly reservation: number;
  readonly halfSpreadBps: number;
  readonly skewBps: number;
  readonly q: number;
  readonly dropped: readonly { side: Side; level: number; reason: DropReason }[];
}

const BPS = 1e4;
const MAX_ABS_SKEW_BPS = 1_000;
const MAX_ABS_Q_FOR_SKEW = 2;

/* ------------------------------ snapping ------------------------------ */

function toDecimal(value: number): Decimal | null {
  return Number.isFinite(value) && value > 0 ? new Decimal(value) : null;
}

/** Bids round down, asks round up, so snapping never makes a quote more aggressive. */
export function snapPrice(value: number, tick: string, side: Side): string {
  const d = toDecimal(value);
  if (d === null) return "0";
  return snapDecimalPrice(d, new Decimal(tick), side).toFixed();
}

function snapDecimalPrice(d: Decimal, tick: Decimal, side: Side): Decimal {
  const units = d.div(tick);
  return (side === "buy" ? units.floor() : units.ceil()).times(tick);
}

export function snapQuantity(value: number, step: string): string {
  const d = toDecimal(value);
  if (d === null) return "0";
  const s = new Decimal(step);
  return d.div(s).floor().times(s).toFixed();
}

/* ------------------------------ book and fair value ------------------------------ */

/** The book without our own resting size, so we never treat our own order as the market. */
export function externalBook(
  bids: readonly PriceLevel[],
  asks: readonly PriceLevel[],
  own: readonly OwnOrder[],
): { bids: PriceLevel[]; asks: PriceLevel[] } {
  const strip = (levels: readonly PriceLevel[], side: Side): PriceLevel[] => {
    const out: PriceLevel[] = [];
    for (const lvl of levels) {
      const price = new Decimal(lvl.price);
      let qty = new Decimal(lvl.quantity);
      for (const o of own) if (o.side === side && price.eq(o.price)) qty = qty.minus(o.quantity);
      if (price.gt(0) && qty.gt(0)) out.push({ price: lvl.price, quantity: qty.toFixed() });
    }
    return out.sort((a, b) => (side === "buy" ? new Decimal(b.price).cmp(a.price) : new Decimal(a.price).cmp(b.price)));
  };
  return { bids: strip(bids, "buy"), asks: strip(asks, "sell") };
}

export type BookHealthReason = "ok" | "invalid_oracle" | "no_bids_in_band" | "no_asks_in_band" | "thin_depth" | "crossed";

export interface BookHealth {
  readonly healthy: boolean;
  readonly reason: BookHealthReason;
  /** Mid of the best in-band levels; null unless healthy. */
  readonly mid: number | null;
  readonly bids: PriceLevel[];
  readonly asks: PriceLevel[];
  readonly bidDepthUsd: number;
  readonly askDepthUsd: number;
}

/**
 * Book health for fair value and the oracle cross-check (PRD 9.2: microprice only "when the book is
 * healthy"). Pass the EXTERNAL book (own orders removed). Only levels within bookHealthBandBps of the
 * oracle count, so stale far-away orders that nobody arbitrages cannot drag the mid. Healthy means
 * both sides have at least bookHealthMinDepthUsd inside the band and the in-band book is not crossed.
 */
export function assessBook(oraclePrice: number, bids: readonly PriceLevel[], asks: readonly PriceLevel[], params: RiskParams): BookHealth {
  const empty = (reason: BookHealthReason, b: PriceLevel[] = [], a: PriceLevel[] = [], bd = 0, ad = 0): BookHealth => ({
    healthy: false,
    reason,
    mid: null,
    bids: b,
    asks: a,
    bidDepthUsd: bd,
    askDepthUsd: ad,
  });
  if (!(oraclePrice > 0) || !Number.isFinite(oraclePrice)) return empty("invalid_oracle");
  const band = params.bookHealthBandBps / BPS;
  const inBand = (l: PriceLevel): boolean => {
    const p = Number(l.price);
    const q = Number(l.quantity);
    return p > 0 && q > 0 && Math.abs(p - oraclePrice) / oraclePrice <= band;
  };
  const b = bids.filter(inBand);
  const a = asks.filter(inBand);
  const depth = (ls: PriceLevel[]): number => ls.reduce((s, l) => s + Number(l.price) * Number(l.quantity), 0);
  const bd = depth(b);
  const ad = depth(a);
  if (b.length === 0) return empty("no_bids_in_band", b, a, bd, ad);
  if (a.length === 0) return empty("no_asks_in_band", b, a, bd, ad);
  if (bd < params.bookHealthMinDepthUsd || ad < params.bookHealthMinDepthUsd) return empty("thin_depth", b, a, bd, ad);
  const bestBid = Math.max(...b.map((l) => Number(l.price)));
  const bestAsk = Math.min(...a.map((l) => Number(l.price)));
  if (bestBid >= bestAsk) return empty("crossed", b, a, bd, ad);
  return { healthy: true, reason: "ok", mid: (bestBid + bestAsk) / 2, bids: b, asks: a, bidDepthUsd: bd, askDepthUsd: ad };
}

export interface FairValue {
  readonly fair: number;
  readonly mid: number | null;
  readonly microprice: number | null;
  readonly bookHealthy: boolean;
  readonly adjustmentBps: number;
}

function bestLevel(levels: readonly PriceLevel[], side: Side): { price: number; qty: number } | null {
  let best: { price: number; qty: number } | null = null;
  for (const l of levels) {
    const price = Number(l.price);
    const qty = Number(l.quantity);
    if (!(price > 0 && qty > 0)) continue;
    if (best === null || (side === "buy" ? price > best.price : price < best.price)) best = { price, qty };
  }
  return best;
}

/** Oracle mark adjusted by the book microprice when the book is healthy (PRD 9.2 step 2). */
export function computeFairValue(
  input: { oraclePrice: number; bids: readonly PriceLevel[]; asks: readonly PriceLevel[] },
  params: RiskParams,
): FairValue {
  const oracle = input.oraclePrice;
  const bid = bestLevel(input.bids, "buy");
  const ask = bestLevel(input.asks, "sell");
  if (bid === null || ask === null || bid.price >= ask.price) {
    return { fair: oracle, mid: null, microprice: null, bookHealthy: false, adjustmentBps: 0 };
  }
  const mid = (bid.price + ask.price) / 2;
  const microprice = (bid.price * ask.qty + ask.price * bid.qty) / (bid.qty + ask.qty);
  const spreadBps = ((ask.price - bid.price) / mid) * BPS;
  if (spreadBps > params.bookHealthyMaxSpreadBps) {
    return { fair: oracle, mid, microprice, bookHealthy: false, adjustmentBps: 0 };
  }
  const rawAdj = params.micropriceWeight * ((microprice - oracle) / oracle) * BPS;
  const adjustmentBps = Math.max(-params.maxMicropriceAdjBps, Math.min(params.maxMicropriceAdjBps, rawAdj));
  return { fair: oracle * (1 + adjustmentBps / BPS), mid, microprice, bookHealthy: true, adjustmentBps };
}

/* ------------------------------ volatility and kappa ------------------------------ */

export interface VolState {
  readonly lastMid: number;
  readonly lastAtMs: number;
  /** EWMA of squared log returns per second, in bps^2 / s. */
  readonly varianceBps2PerSec: number;
}

export function updateVolatility(state: VolState | null, mid: number, atMs: number, params: RiskParams): VolState {
  if (!(mid > 0) || !Number.isFinite(mid)) return state ?? { lastMid: 0, lastAtMs: atMs, varianceBps2PerSec: params.sigmaFloorBps ** 2 };
  if (state === null || !(state.lastMid > 0)) {
    return { lastMid: mid, lastAtMs: atMs, varianceBps2PerSec: params.sigmaFloorBps ** 2 };
  }
  const dtSec = (atMs - state.lastAtMs) / 1_000;
  if (!(dtSec > 0)) return state;
  const rBps = Math.log(mid / state.lastMid) * BPS;
  const alpha = 1 - 0.5 ** (dtSec / params.ewmaHalfLifeSec);
  const variance = (1 - alpha) * state.varianceBps2PerSec + alpha * ((rBps * rBps) / dtSec);
  return { lastMid: mid, lastAtMs: atMs, varianceBps2PerSec: variance };
}

export function sigmaBps(state: VolState | null, params: RiskParams): number {
  if (state === null) return params.sigmaFloorBps;
  return Math.max(params.sigmaFloorBps, Math.sqrt(state.varianceBps2PerSec));
}

export interface KappaState {
  readonly weight: number;
  readonly sumDistanceBps: number;
}

/** Older fills fade so kappa tracks the current regime. */
const KAPPA_FORGET = 0.995;

/** Record the distance (bps from fair at quote time) of a filled maker order. */
export function updateKappa(state: KappaState | null, distanceBps: number): KappaState | null {
  if (!Number.isFinite(distanceBps) || distanceBps < 0) return state;
  const w = state?.weight ?? 0;
  const s = state?.sumDistanceBps ?? 0;
  return { weight: w * KAPPA_FORGET + 1, sumDistanceBps: s * KAPPA_FORGET + distanceBps };
}

/**
 * Fill distances under lambda(d) = A * exp(-kappa * d) are exponential, so the MLE is 1 / mean.
 * A pseudo-count prior at `params.kappa` keeps the estimate stable with few fills.
 */
export function estimateKappa(state: KappaState | null, params: RiskParams): number {
  const prior = params.kappa;
  const w0 = params.kappaPriorWeight;
  const k = state === null ? prior : (state.weight + w0) / (state.sumDistanceBps + w0 / prior);
  return Math.min(50, Math.max(0.01, k));
}

/* ------------------------------ quotes ------------------------------ */

export function halfSpreadBps(sigma: number, kappa: number, params: RiskParams): number {
  const g = params.gamma;
  const as = (g * sigma * sigma * params.horizonSec) / 2 + (1 / g) * Math.log(1 + g / kappa);
  return Math.max(params.minHalfSpreadBps, as);
}

function fundingSkewBps(fundingRateHourly: number | null, params: RiskParams): number {
  if (fundingRateHourly === null || !Number.isFinite(fundingRateHourly)) return 0;
  // Positive funding: longs pay, so lean short by moving the reservation down.
  const raw = params.fundingSkewFactor * fundingRateHourly * BPS;
  return Math.max(-params.maxFundingSkewBps, Math.min(params.maxFundingSkewBps, raw));
}

interface SideCtx {
  readonly side: Side;
  readonly tick: Decimal;
  readonly step: Decimal;
  readonly minNotional: Decimal;
  /** Most aggressive allowed price (inclusive), from the external book and own opposite quotes. */
  readonly limit: Decimal | null;
  /** Max cumulative base quantity for this side. */
  readonly capacity: Decimal;
  readonly reduceOnly: boolean;
}

function buildSide(
  ctx: SideCtx,
  rawPrices: readonly number[],
  usdSizes: readonly number[],
  dropped: { side: Side; level: number; reason: DropReason }[],
): QuoteLevel[] {
  const out: QuoteLevel[] = [];
  let remaining = ctx.capacity;
  let prev: Decimal | null = null;
  const isBuy = ctx.side === "buy";
  for (let i = 0; i < rawPrices.length; i++) {
    const raw = toDecimal(rawPrices[i]!);
    let price = raw === null ? new Decimal(0) : snapDecimalPrice(raw, ctx.tick, ctx.side);
    if (ctx.limit !== null) price = isBuy ? Decimal.min(price, ctx.limit) : Decimal.max(price, ctx.limit);
    if (prev !== null) price = isBuy ? Decimal.min(price, prev.minus(ctx.tick)) : Decimal.max(price, prev.plus(ctx.tick));
    if (price.lte(0)) {
      dropped.push({ side: ctx.side, level: i, reason: "non_positive_price" });
      continue;
    }
    let qty = new Decimal(usdSizes[i]!).div(price).div(ctx.step).floor().times(ctx.step);
    const forNotional = ctx.minNotional.div(price).div(ctx.step).ceil().times(ctx.step);
    qty = Decimal.max(qty, ctx.step, forNotional);
    if (qty.gt(remaining)) qty = remaining.div(ctx.step).floor().times(ctx.step);
    if (qty.lte(0) || qty.lt(ctx.step) || qty.times(price).lt(ctx.minNotional)) {
      dropped.push({ side: ctx.side, level: i, reason: qty.lte(0) ? "inventory_capacity" : "below_minimum" });
      break;
    }
    remaining = remaining.minus(qty);
    prev = price;
    out.push({ side: ctx.side, price: price.toFixed(), quantity: qty.toFixed(), level: i, reduceOnly: ctx.reduceOnly });
  }
  return out;
}

export function computeQuotes(input: QuoteInput, params: RiskParams): QuotePlan {
  const { fair, market, session } = input;
  const empty = (reservation: number, half: number, skew: number, q: number): QuotePlan => ({
    quotes: [],
    reservation,
    halfSpreadBps: half,
    skewBps: skew,
    q,
    dropped: [],
  });
  if (!(fair > 0) || !Number.isFinite(fair)) return empty(0, 0, 0, 0);

  const capUsd = params.inventoryCapUsd * session.inventoryCapMultiplier;
  const invUsd = input.inventoryBase * fair;
  const q = invUsd / capUsd;
  const qs = Math.max(-MAX_ABS_Q_FOR_SKEW, Math.min(MAX_ABS_Q_FOR_SKEW, q));
  const sig2T = input.sigmaBps * input.sigmaBps * params.horizonSec;
  const rawSkew = -(qs * params.gamma * sig2T) - params.capSkewBps * qs ** 3 - fundingSkewBps(input.fundingRateHourly, params);
  const skewBps = Math.max(-MAX_ABS_SKEW_BPS, Math.min(MAX_ABS_SKEW_BPS, rawSkew)) + 0;
  const reservation = fair * (1 + skewBps / BPS);
  const half = halfSpreadBps(input.sigmaBps, input.kappa, params) * session.spreadMultiplier;

  const tick = new Decimal(market.tickSize);
  const step = new Decimal(market.minQuantity);
  const minNotional = new Decimal(market.minNotional);
  const ext = externalBook(input.bids, input.asks, input.ownOrders);
  const extBestBid = ext.bids[0] ? new Decimal(ext.bids[0].price) : null;
  const extBestAsk = ext.asks[0] ? new Decimal(ext.asks[0].price) : null;
  const dropped: { side: Side; level: number; reason: DropReason }[] = [];

  const absInv = new Decimal(Math.abs(input.inventoryBase));
  const reducingSide: Side | null = input.inventoryBase > 0 ? "sell" : input.inventoryBase < 0 ? "buy" : null;

  if (input.mode !== "normal") {
    if (reducingSide === null) return empty(reservation, half, skewBps, q);
    const reduceCapacity = absInv.div(step).floor().times(step);
    const isBuy = reducingSide === "buy";
    const limit = isBuy ? (extBestAsk ? extBestAsk.minus(tick) : null) : extBestBid ? extBestBid.plus(tick) : null;
    if (input.mode === "flatten") {
      const raw = reservation * (1 + ((isBuy ? -1 : 1) * params.minHalfSpreadBps) / BPS);
      const quotes = buildSide(
        { side: reducingSide, tick, step, minNotional: new Decimal(0), limit, capacity: reduceCapacity, reduceOnly: true },
        [raw],
        [Number.MAX_SAFE_INTEGER],
        dropped,
      );
      return { quotes, reservation, halfSpreadBps: half, skewBps, q, dropped };
    }
    const { prices, sizes } = ladder(reducingSide, reservation, half, params, session);
    const quotes = buildSide(
      { side: reducingSide, tick, step, minNotional, limit, capacity: reduceCapacity, reduceOnly: true },
      prices,
      sizes,
      dropped,
    );
    return { quotes, reservation, halfSpreadBps: half, skewBps, q, dropped };
  }

  const buyCapacity = new Decimal(Math.max(0, (capUsd - invUsd) / fair));
  const sellCapacity = new Decimal(Math.max(0, (capUsd + invUsd) / fair));

  const askL = ladder("sell", reservation, half, params, session);
  const asks = buildSide(
    { side: "sell", tick, step, minNotional, limit: extBestBid ? extBestBid.plus(tick) : null, capacity: sellCapacity, reduceOnly: false },
    askL.prices,
    askL.sizes,
    dropped,
  );
  // Own bids stay at least two ticks under our lowest ask (never within one tick of own opposite order).
  const ownAskLimit = asks.length > 0 ? Decimal.min(...asks.map((a) => new Decimal(a.price))).minus(tick.times(2)) : null;
  const extAskLimit = extBestAsk ? extBestAsk.minus(tick) : null;
  const bidLimit =
    ownAskLimit !== null && extAskLimit !== null ? Decimal.min(ownAskLimit, extAskLimit) : (ownAskLimit ?? extAskLimit);
  const bidL = ladder("buy", reservation, half, params, session);
  const bids = buildSide(
    { side: "buy", tick, step, minNotional, limit: bidLimit, capacity: buyCapacity, reduceOnly: false },
    bidL.prices,
    bidL.sizes,
    dropped,
  );
  return { quotes: [...bids, ...asks], reservation, halfSpreadBps: half, skewBps, q, dropped };
}

function ladder(
  side: Side,
  reservation: number,
  half: number,
  params: RiskParams,
  session: SessionMultipliers,
): { prices: number[]; sizes: number[] } {
  const sign = side === "buy" ? -1 : 1;
  const prices: number[] = [];
  const sizes: number[] = [];
  for (let i = 0; i < params.levels; i++) {
    const dist = half + i * params.levelSpacingBps * session.spreadMultiplier;
    prices.push(reservation * (1 + (sign * dist) / BPS));
    sizes.push(params.baseOrderSizeUsd * params.sizeMultiplier * session.sizeMultiplier * params.levelSizeGrowth ** i);
  }
  return { prices, sizes };
}
