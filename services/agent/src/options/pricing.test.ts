import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { black76, impliedVol, normCdf, strikeForDelta } from "./pricing.js";

describe("normCdf", () => {
  it("matches reference values", () => {
    expect(normCdf(0)).toBeCloseTo(0.5, 7);
    expect(normCdf(1)).toBeCloseTo(0.8413447461, 6);
    expect(normCdf(-1.96)).toBeCloseTo(0.0249978952, 6);
    expect(normCdf(3)).toBeCloseTo(0.9986501020, 6);
  });
});

describe("black76 (r = 0)", () => {
  // Reference: F = 100, K = 100, T = 1, sigma = 0.2: ATM price = F (2 N(sigma/2) - 1) = 7.9655674.
  it("prices an at-the-money call and put", () => {
    const call = black76({ kind: "call", forward: 100, strike: 100, years: 1, sigma: 0.2 });
    const put = black76({ kind: "put", forward: 100, strike: 100, years: 1, sigma: 0.2 });
    expect(call.price).toBeCloseTo(7.9655674, 5);
    expect(put.price).toBeCloseTo(7.9655674, 5);
    expect(call.delta).toBeCloseTo(normCdf(0.1), 9);
    expect(put.delta).toBeCloseTo(normCdf(0.1) - 1, 9);
  });

  it("prices an out-of-the-money call against a published value", () => {
    // F = 100, K = 110, T = 0.5, sigma = 0.3. d1 = (ln(100/110) + 0.0225) / 0.212132 = -0.343227.
    const call = black76({ kind: "call", forward: 100, strike: 110, years: 0.5, sigma: 0.3 });
    expect(call.price).toBeCloseTo(100 * normCdf(-0.343227) - 110 * normCdf(-0.555359), 3);
    expect(call.vega).toBeGreaterThan(0);
  });

  it("satisfies put-call parity C - P = F - K", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 10_000, noNaN: true }),
        fc.double({ min: 0.5, max: 1.5, noNaN: true }),
        fc.double({ min: 1 / 365, max: 1, noNaN: true }),
        fc.double({ min: 0.05, max: 2, noNaN: true }),
        (forward, moneyness, years, sigma) => {
          const strike = forward * moneyness;
          const c = black76({ kind: "call", forward, strike, years, sigma }).price;
          const p = black76({ kind: "put", forward, strike, years, sigma }).price;
          expect(c - p).toBeCloseTo(forward - strike, Math.max(0, 6 - Math.ceil(Math.log10(forward))));
        },
      ),
    );
  });

  it("returns intrinsic value at expiry", () => {
    expect(black76({ kind: "call", forward: 105, strike: 100, years: 0, sigma: 0.2 }).price).toBe(5);
    expect(black76({ kind: "put", forward: 105, strike: 100, years: 0, sigma: 0.2 }).price).toBe(0);
  });

  it("rejects invalid inputs", () => {
    expect(() => black76({ kind: "call", forward: -1, strike: 100, years: 1, sigma: 0.2 })).toThrow();
    expect(() => black76({ kind: "call", forward: 100, strike: 100, years: 1, sigma: Number.NaN })).toThrow();
  });
});

describe("impliedVol", () => {
  it("recovers the volatility used to price an option", () => {
    fc.assert(
      fc.property(fc.double({ min: 0.05, max: 1.5, noNaN: true }), fc.constantFrom<"call" | "put">("call", "put"), (sigma, kind) => {
        const price = black76({ kind, forward: 2000, strike: kind === "call" ? 2100 : 1900, years: 7 / 365, sigma }).price;
        fc.pre(price > 1e-6);
        expect(impliedVol({ kind, forward: 2000, strike: kind === "call" ? 2100 : 1900, years: 7 / 365, price })).toBeCloseTo(sigma, 4);
      }),
    );
  });

  it("returns null for a price below intrinsic or above the forward", () => {
    expect(impliedVol({ kind: "call", forward: 100, strike: 90, years: 0.1, price: 5 })).toBeNull();
    expect(impliedVol({ kind: "call", forward: 100, strike: 90, years: 0.1, price: 150 })).toBeNull();
  });
});

describe("strikeForDelta", () => {
  it("finds the call strike whose delta is the target", () => {
    const k = strikeForDelta({ kind: "call", forward: 5000, years: 5 / 365, sigma: 0.18, targetAbsDelta: 0.2 });
    expect(k).toBeGreaterThan(5000);
    expect(black76({ kind: "call", forward: 5000, strike: k, years: 5 / 365, sigma: 0.18 }).delta).toBeCloseTo(0.2, 6);
  });

  it("finds the put strike whose absolute delta is the target", () => {
    const k = strikeForDelta({ kind: "put", forward: 5000, years: 5 / 365, sigma: 0.18, targetAbsDelta: 0.25 });
    expect(k).toBeLessThan(5000);
    expect(black76({ kind: "put", forward: 5000, strike: k, years: 5 / 365, sigma: 0.18 }).delta).toBeCloseTo(-0.25, 6);
  });
});
