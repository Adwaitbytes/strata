/**
 * Black-76 with zero rates (PRD 9.8, docs/OPTIONS.md). The forward is the underlying perp's oracle
 * price; with r = 0 this equals Black-Scholes on spot. Used only by the options simulator, so every
 * number derived from it is SIMULATED.
 */
export type OptionKind = "call" | "put";

export interface PricingInput {
  readonly kind: OptionKind;
  readonly forward: number;
  readonly strike: number;
  /** Time to expiry in years (calendar, 365 days). */
  readonly years: number;
  /** Annualized volatility. */
  readonly sigma: number;
}

export interface Greeks {
  readonly price: number;
  /** Per unit of underlying: call in [0, 1], put in [-1, 0]. */
  readonly delta: number;
  /** Price change per 1.00 change in sigma. */
  readonly vega: number;
}

/** Standard normal CDF, Hart (1968) double-precision algorithm as given by West (2005), abs error near 1e-14. */
export function normCdf(x: number): number {
  const z = Math.abs(x);
  let tail: number;
  if (z > 37) {
    tail = 0;
  } else {
    const e = Math.exp(-0.5 * z * z);
    if (z < 7.07106781186547) {
      let num = 3.52624965998911e-2 * z + 0.700383064443688;
      num = num * z + 6.37396220353165;
      num = num * z + 33.912866078383;
      num = num * z + 112.079291497871;
      num = num * z + 221.213596169931;
      num = num * z + 220.206867912376;
      let den = 8.83883476483184e-2 * z + 1.75566716318264;
      den = den * z + 16.064177579207;
      den = den * z + 86.7807322029461;
      den = den * z + 296.564248779674;
      den = den * z + 637.333633378831;
      den = den * z + 793.826512519948;
      den = den * z + 440.413735824752;
      tail = (e * num) / den;
    } else {
      const cf = z + 1 / (z + 2 / (z + 3 / (z + 4 / (z + 0.65))));
      tail = e / cf / 2.506628274631;
    }
  }
  return x > 0 ? 1 - tail : tail;
}

const normPdf = (x: number): number => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

function assertInput(i: PricingInput): void {
  const ok = Number.isFinite(i.forward) && i.forward > 0 && Number.isFinite(i.strike) && i.strike > 0 && Number.isFinite(i.years) && i.years >= 0 && Number.isFinite(i.sigma) && i.sigma > 0;
  if (!ok) throw new Error(`invalid pricing input ${JSON.stringify(i)}`);
}

export function black76(i: PricingInput): Greeks {
  assertInput(i);
  const { kind, forward: f, strike: k, years: t, sigma } = i;
  if (t === 0) {
    const itm = kind === "call" ? f > k : f < k;
    return { price: kind === "call" ? Math.max(f - k, 0) : Math.max(k - f, 0), delta: itm ? (kind === "call" ? 1 : -1) : 0, vega: 0 };
  }
  const sd = sigma * Math.sqrt(t);
  const d1 = (Math.log(f / k) + 0.5 * sd * sd) / sd;
  const d2 = d1 - sd;
  const vega = f * normPdf(d1) * Math.sqrt(t);
  if (kind === "call") return { price: f * normCdf(d1) - k * normCdf(d2), delta: normCdf(d1), vega };
  return { price: k * normCdf(-d2) - f * normCdf(-d1), delta: normCdf(d1) - 1, vega };
}

/** Bisection on sigma in [1e-4, 10]. Null when the price is outside the no-arbitrage range. */
export function impliedVol(i: Omit<PricingInput, "sigma"> & { readonly price: number }): number | null {
  const intrinsic = i.kind === "call" ? Math.max(i.forward - i.strike, 0) : Math.max(i.strike - i.forward, 0);
  const upper = i.kind === "call" ? i.forward : i.strike;
  if (!Number.isFinite(i.price) || i.price <= intrinsic || i.price >= upper || i.years <= 0) return null;
  let lo = 1e-4;
  let hi = 10;
  if (black76({ ...i, sigma: hi }).price < i.price) return null;
  for (let n = 0; n < 200 && hi - lo > 1e-10; n++) {
    const mid = 0.5 * (lo + hi);
    if (black76({ ...i, sigma: mid }).price < i.price) lo = mid;
    else hi = mid;
  }
  return 0.5 * (lo + hi);
}

/** Strike whose |delta| equals the target, by bisection on log-moneyness (delta is monotone in K). */
export function strikeForDelta(i: Omit<PricingInput, "strike"> & { readonly targetAbsDelta: number }): number {
  if (!(i.targetAbsDelta > 0 && i.targetAbsDelta < 1) || !(i.years > 0)) throw new Error("targetAbsDelta must be in (0, 1) and years > 0");
  const absDelta = (k: number): number => Math.abs(black76({ kind: i.kind, forward: i.forward, strike: k, years: i.years, sigma: i.sigma }).delta);
  // |delta| falls with K for calls and rises with K for puts.
  let lo = Math.log(i.forward) - 10 * i.sigma * Math.sqrt(i.years) - 1;
  let hi = Math.log(i.forward) + 10 * i.sigma * Math.sqrt(i.years) + 1;
  for (let n = 0; n < 200 && hi - lo > 1e-12; n++) {
    const mid = 0.5 * (lo + hi);
    const d = absDelta(Math.exp(mid));
    const moveUp = i.kind === "call" ? d > i.targetAbsDelta : d < i.targetAbsDelta;
    if (moveUp) lo = mid;
    else hi = mid;
  }
  return Math.exp(0.5 * (lo + hi));
}
