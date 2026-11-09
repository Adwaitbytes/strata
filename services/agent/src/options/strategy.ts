/**
 * Options-writer strategy (PRD 9.8, docs/OPTIONS.md): covered calls and cash-secured puts at
 * |delta| 0.15 to 0.30, weekly expiries at a time the underlying is open, and a premium floor
 * from implied vs realized volatility. Pure functions plus a small EWMA estimator; the runner
 * supplies prices and time. Every output is SIMULATED.
 */
import { createHash } from "node:crypto";
import { CALENDAR, tradingIntervals, zonedTimeToUtc, type SessionClass } from "@strata/risk";
import { maxPayoutPerUnit } from "./book.js";
import { black76, impliedVol, strikeForDelta, type OptionKind } from "./pricing.js";

export const YEAR_MS = 365 * 86_400_000;
const YEAR_SEC = YEAR_MS / 1000;

export interface StrategyParams {
  readonly targetAbsDelta: number;
  readonly minAbsDelta: number;
  readonly maxAbsDelta: number;
  /** Annualized sigma floor used when realized vol is lower. */
  readonly volFloor: number;
  /** Quote only when the premium implies at least realized vol x this multiple. */
  readonly ivFloorMultiple: number;
  /** USDC locked per write. */
  readonly collateralPerWriteUsd: number;
  readonly callCapMultiple: number;
  /** Simulated buyer: probability of taking a quote priced at fair value. */
  readonly baseFillProbability: number;
  /** Simulated buyer: how fast that probability falls as premium / fair rises. */
  readonly fillDecay: number;
}

/* ------------------------------ realized volatility ------------------------------ */

/** EWMA of squared log returns per second, annualized over a 365-day year. */
export class EwmaVol {
  readonly #halfLifeSec: number;
  readonly #minReturns: number;
  #last: { price: number; tsMs: number } | null = null;
  #varPerSec = 0;
  #n = 0;

  constructor(opts: { halfLifeSec: number; minReturns: number }) {
    this.#halfLifeSec = opts.halfLifeSec;
    this.#minReturns = opts.minReturns;
  }

  update(price: number, tsMs: number): void {
    if (!(Number.isFinite(price) && price > 0)) return;
    const last = this.#last;
    if (last !== null && tsMs <= last.tsMs) return;
    this.#last = { price, tsMs };
    if (last === null) return;
    const dtSec = (tsMs - last.tsMs) / 1000;
    const r = Math.log(price / last.price);
    const sample = (r * r) / dtSec;
    const w = 1 - 2 ** (-dtSec / this.#halfLifeSec);
    this.#varPerSec = this.#n === 0 ? sample : (1 - w) * this.#varPerSec + w * sample;
    this.#n++;
  }

  returns(): number {
    return this.#n;
  }

  sigma(): number | null {
    return this.#n >= this.#minReturns ? Math.sqrt(this.#varPerSec * YEAR_SEC) : null;
  }
}

/* ------------------------------ expiry ------------------------------ */

const nyParts = new Intl.DateTimeFormat("en-US", { timeZone: CALENDAR.timezone, year: "numeric", month: "numeric", day: "numeric", weekday: "short" });

function nyCivil(ms: number): { y: number; m: number; d: number; weekday: string } {
  const parts = Object.fromEntries(nyParts.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
  return { y: Number(parts["year"]), m: Number(parts["month"]), d: Number(parts["day"]), weekday: String(parts["weekday"]) };
}

/**
 * The first Friday session close at least `minTenorMs` away (docs/OPTIONS.md: Friday 16:00 New
 * York for US indices, Friday 17:00 for Globex metals and energy). A Friday holiday rolls to the
 * next week. Always-open underlyings (SICI) use Friday 16:00 New York. Null if none within 3 weeks.
 */
export function nextExpiry(cls: SessionClass, nowMs: number, minTenorMs: number): number | null {
  const earliest = nowMs + minTenorMs;
  const horizon = nowMs + 21 * 86_400_000;
  if (cls === "always_open") {
    for (let t = nowMs; t <= horizon; t += 86_400_000) {
      const c = nyCivil(t);
      if (c.weekday !== "Fri") continue;
      const expiry = zonedTimeToUtc(c.y, c.m, c.d, 16, 0, 0, CALENDAR.timezone);
      if (expiry >= earliest) return expiry;
    }
    return null;
  }
  const close = tradingIntervals(cls, nowMs, horizon)
    .map((iv) => iv.closeMs)
    .find((ms) => ms >= earliest && nyCivil(ms - 1).weekday === "Fri");
  return close ?? null;
}

/* ------------------------------ strikes ------------------------------ */

/** Strike grid: the largest 1-2-5 step at or below 0.25% of the forward. */
export function strikeStep(forward: number): number {
  const target = forward * 0.0025;
  const decade = 10 ** Math.floor(Math.log10(target));
  for (const m of [5, 2, 1]) if (m * decade <= target) return m * decade;
  return decade;
}

export interface StrikeChoice {
  readonly strike: number;
  readonly delta: number;
}

export function selectStrike(i: { kind: OptionKind; forward: number; sigma: number; years: number }, p: StrategyParams): StrikeChoice | null {
  const exact = strikeForDelta({ kind: i.kind, forward: i.forward, years: i.years, sigma: i.sigma, targetAbsDelta: p.targetAbsDelta });
  const step = strikeStep(i.forward);
  const center = Math.round(exact / step);
  let best: StrikeChoice | null = null;
  for (let n = center - 6; n <= center + 6; n++) {
    const strike = Number((n * step).toPrecision(12));
    if (strike <= 0) continue;
    if (i.kind === "call" ? strike <= i.forward : strike >= i.forward) continue;
    const delta = black76({ kind: i.kind, forward: i.forward, strike, years: i.years, sigma: i.sigma }).delta;
    const abs = Math.abs(delta);
    if (abs < p.minAbsDelta || abs > p.maxAbsDelta) continue;
    if (best === null || Math.abs(abs - p.targetAbsDelta) < Math.abs(Math.abs(best.delta) - p.targetAbsDelta)) best = { strike, delta };
  }
  return best;
}

/* ------------------------------ quotes ------------------------------ */

export interface QuoteInput {
  readonly kind: OptionKind;
  readonly spot: number;
  readonly realizedVol: number | null;
  readonly nowMs: number;
  readonly expiryMs: number;
}

export type QuoteSkipReason = "vol_warming_up" | "expired" | "no_strike_in_delta_band" | "below_premium_floor" | "size_too_small";

export type QuoteDecision =
  | {
      readonly kind: "quote";
      readonly strike: number;
      readonly delta: number;
      readonly years: number;
      readonly realizedVol: number;
      readonly sigmaFair: number;
      readonly sigmaQuote: number;
      readonly impliedVol: number;
      readonly fairValuePerUnit: number;
      readonly premiumPerUnit: number;
      readonly size: number;
      readonly collateralUsd: number;
      readonly premiumUsd: number;
    }
  | { readonly kind: "skip"; readonly reason: QuoteSkipReason };

export function buildQuote(i: QuoteInput, p: StrategyParams): QuoteDecision {
  if (i.realizedVol === null) return { kind: "skip", reason: "vol_warming_up" };
  const years = (i.expiryMs - i.nowMs) / YEAR_MS;
  if (!(years > 0)) return { kind: "skip", reason: "expired" };
  const sigmaFair = Math.max(i.realizedVol, p.volFloor);
  const sigmaQuote = sigmaFair * p.ivFloorMultiple;
  const choice = selectStrike({ kind: i.kind, forward: i.spot, sigma: sigmaFair, years }, p);
  if (choice === null) return { kind: "skip", reason: "no_strike_in_delta_band" };
  const fairValuePerUnit = black76({ kind: i.kind, forward: i.spot, strike: choice.strike, years, sigma: sigmaFair }).price;
  const premiumPerUnit = black76({ kind: i.kind, forward: i.spot, strike: choice.strike, years, sigma: sigmaQuote }).price;
  const iv = impliedVol({ kind: i.kind, forward: i.spot, strike: choice.strike, years, price: premiumPerUnit });
  // The floor is checked on the quoted price itself, not assumed from how it was built.
  if (iv === null || iv < i.realizedVol * p.ivFloorMultiple - 1e-6) return { kind: "skip", reason: "below_premium_floor" };
  const size = Math.floor((p.collateralPerWriteUsd / maxPayoutPerUnit(i.kind, choice.strike, p.callCapMultiple)) * 1e6) / 1e6;
  if (!(size > 0)) return { kind: "skip", reason: "size_too_small" };
  return {
    kind: "quote",
    strike: choice.strike,
    delta: choice.delta,
    years,
    realizedVol: i.realizedVol,
    sigmaFair,
    sigmaQuote,
    impliedVol: iv,
    fairValuePerUnit,
    premiumPerUnit,
    size,
    collateralUsd: size * maxPayoutPerUnit(i.kind, choice.strike, p.callCapMultiple),
    premiumUsd: size * premiumPerUnit,
  };
}

/* ------------------------------ simulated buyers ------------------------------ */

export function acceptProbability(premium: number, fair: number, p: StrategyParams): number {
  if (!(fair > 0)) return 0;
  return Math.min(1, p.baseFillProbability * Math.exp(-p.fillDecay * (premium / fair - 1)));
}

/** Deterministic per quote id: a hash of the id is the buyer's uniform draw. SIMULATED behavior. */
export function buyerAccepts(quoteId: string, premium: number, fair: number, p: StrategyParams): boolean {
  const u = parseInt(createHash("sha256").update(quoteId).digest("hex").slice(0, 12), 16) / 2 ** 48;
  return u < acceptProbability(premium, fair, p);
}
