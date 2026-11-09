import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { CALENDAR, zonedTimeToUtc } from "@strata/risk";
import { black76, impliedVol } from "./pricing.js";
import { EwmaVol, acceptProbability, buildQuote, buyerAccepts, nextExpiry, selectStrike, strikeStep, type StrategyParams } from "./strategy.js";

const params: StrategyParams = {
  targetAbsDelta: 0.2,
  minAbsDelta: 0.15,
  maxAbsDelta: 0.3,
  volFloor: 0.08,
  ivFloorMultiple: 1.2,
  collateralPerWriteUsd: 500,
  callCapMultiple: 1,
  baseFillProbability: 0.35,
  fillDecay: 3,
};

describe("EwmaVol", () => {
  it("is null until enough returns are seen", () => {
    const v = new EwmaVol({ halfLifeSec: 3600, minReturns: 3 });
    v.update(100, 0);
    v.update(101, 60_000);
    v.update(100, 120_000);
    expect(v.sigma()).toBeNull();
    v.update(101, 180_000);
    expect(v.sigma()).not.toBeNull();
  });

  it("annualizes a constant per-step log return", () => {
    const v = new EwmaVol({ halfLifeSec: 3600, minReturns: 2 });
    let p = 100;
    for (let i = 0; i <= 200; i++) {
      v.update(p, i * 60_000);
      p *= i % 2 === 0 ? Math.exp(0.001) : Math.exp(-0.001);
    }
    // Variance per second = 0.001^2 / 60, annualized over 365 days.
    expect(v.sigma()).toBeCloseTo(Math.sqrt((1e-6 / 60) * 365 * 86_400), 3);
  });

  it("ignores repeated reports with the same timestamp", () => {
    const v = new EwmaVol({ halfLifeSec: 3600, minReturns: 1 });
    v.update(100, 0);
    v.update(150, 0);
    expect(v.sigma()).toBeNull();
    expect(v.returns()).toBe(0);
  });
});

describe("nextExpiry", () => {
  const monday = zonedTimeToUtc(2026, 11, 9, 10, 0, 0, CALENDAR.timezone);

  it("expires US index options at the Friday 16:00 New York close", () => {
    expect(nextExpiry("us_equity", monday, 86_400_000)).toBe(zonedTimeToUtc(2026, 11, 13, 16, 0, 0, CALENDAR.timezone));
  });

  it("expires commodity options at the Friday 17:00 New York Globex close", () => {
    expect(nextExpiry("cme_globex", monday, 86_400_000)).toBe(zonedTimeToUtc(2026, 11, 13, 17, 0, 0, CALENDAR.timezone));
  });

  it("rolls to the next week when Friday is too close", () => {
    const thursday = zonedTimeToUtc(2026, 11, 12, 18, 0, 0, CALENDAR.timezone);
    expect(nextExpiry("us_equity", thursday, 86_400_000)).toBe(zonedTimeToUtc(2026, 11, 20, 16, 0, 0, CALENDAR.timezone));
  });

  it("uses Friday 16:00 New York for an always-open underlying", () => {
    expect(nextExpiry("always_open", monday, 86_400_000)).toBe(zonedTimeToUtc(2026, 11, 13, 16, 0, 0, CALENDAR.timezone));
  });
});

describe("selectStrike", () => {
  it("rounds to the strike grid and keeps |delta| inside 0.15 to 0.30", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<"call" | "put">("call", "put"),
        fc.double({ min: 1, max: 100_000, noNaN: true }),
        fc.double({ min: 0.08, max: 1.2, noNaN: true }),
        fc.double({ min: 1 / 365, max: 14 / 365, noNaN: true }),
        (kind, forward, sigma, years) => {
          const s = selectStrike({ kind, forward, sigma, years }, params);
          fc.pre(s !== null);
          if (s === null) return;
          const d = Math.abs(black76({ kind, forward, strike: s.strike, years, sigma }).delta);
          expect(d).toBeGreaterThanOrEqual(0.15);
          expect(d).toBeLessThanOrEqual(0.3);
          expect(Math.abs(s.delta)).toBeCloseTo(d, 9);
          expect(kind === "call" ? s.strike > forward : s.strike < forward).toBe(true);
          const step = strikeStep(forward);
          expect(Math.abs(s.strike / step - Math.round(s.strike / step))).toBeLessThan(1e-6);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("picks a strike near the 0.20 delta target", () => {
    const s = selectStrike({ kind: "call", forward: 736.66, sigma: 0.15, years: 4 / 365 }, params);
    expect(s).not.toBeNull();
    expect(Math.abs((s?.delta ?? 0) - 0.2)).toBeLessThan(0.05);
  });
});

describe("buildQuote", () => {
  const now = zonedTimeToUtc(2026, 11, 9, 10, 0, 0, CALENDAR.timezone);
  const expiry = zonedTimeToUtc(2026, 11, 13, 16, 0, 0, CALENDAR.timezone);

  it("quotes a premium whose implied vol clears realized vol x ivFloorMultiple", () => {
    const q = buildQuote({ kind: "put", spot: 3400, realizedVol: 0.18, nowMs: now, expiryMs: expiry }, params);
    if (q.kind !== "quote") throw new Error(q.reason);
    const years = (expiry - now) / (365 * 86_400_000);
    const iv = impliedVol({ kind: "put", forward: 3400, strike: q.strike, years, price: q.premiumPerUnit });
    expect(iv).not.toBeNull();
    expect(iv ?? 0).toBeGreaterThanOrEqual(0.18 * 1.2 - 1e-6);
    expect(q.premiumPerUnit).toBeGreaterThan(q.fairValuePerUnit);
    expect(q.collateralUsd).toBeCloseTo(q.size * q.strike, 6);
    expect(q.collateralUsd).toBeLessThanOrEqual(params.collateralPerWriteUsd + 1e-9);
  });

  it("uses the vol floor when realized vol is very low", () => {
    const q = buildQuote({ kind: "call", spot: 100, realizedVol: 0.01, nowMs: now, expiryMs: expiry }, params);
    if (q.kind !== "quote") throw new Error(q.reason);
    expect(q.sigmaFair).toBe(0.08);
  });

  it("skips when realized vol is unknown", () => {
    expect(buildQuote({ kind: "call", spot: 100, realizedVol: null, nowMs: now, expiryMs: expiry }, params)).toEqual({ kind: "skip", reason: "vol_warming_up" });
  });
});

describe("simulated buyers", () => {
  it("are deterministic per quote id", () => {
    expect(buyerAccepts("q-1", 1.2, 1, params)).toBe(buyerAccepts("q-1", 1.2, 1, params));
  });

  it("accept less often as the premium moves above fair value", () => {
    expect(acceptProbability(1.2, 1, params)).toBeGreaterThan(acceptProbability(1.6, 1, params));
    expect(acceptProbability(1, 1, params)).toBeCloseTo(0.35, 9);
    const hits = (ratio: number) => Array.from({ length: 2000 }, (_, i) => buyerAccepts(`q-${i}`, ratio, 1, params)).filter(Boolean).length;
    expect(hits(1.2)).toBeGreaterThan(hits(2));
  });
});
