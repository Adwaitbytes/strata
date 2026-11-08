import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { Decimal } from "decimal.js";
import { DEFAULT_PARAMS, type RiskParams } from "../src/params.js";
import {
  assessBook,
  computeFairValue,
  computeQuotes,
  estimateKappa,
  externalBook,
  halfSpreadBps,
  sigmaBps,
  snapPrice,
  snapQuantity,
  updateKappa,
  updateVolatility,
  type QuoteInput,
  type QuoteLevel,
} from "../src/quoting.js";

const P: RiskParams = { ...DEFAULT_PARAMS };
const NEUTRAL_SESSION = { spreadMultiplier: 1, sizeMultiplier: 1, inventoryCapMultiplier: 1 };

function baseInput(over: Partial<QuoteInput> = {}): QuoteInput {
  return {
    fair: 100,
    sigmaBps: 1,
    kappa: 0.5,
    inventoryBase: 0,
    fundingRateHourly: null,
    bids: [{ price: "99.9", quantity: "10" }],
    asks: [{ price: "100.1", quantity: "10" }],
    ownOrders: [],
    market: { tickSize: "0.01", minQuantity: "0.001", minNotional: "1" },
    session: NEUTRAL_SESSION,
    mode: "normal",
    ...over,
  };
}

const sideOf = (qs: readonly QuoteLevel[], side: "buy" | "sell") => qs.filter((q) => q.side === side);
const isMultiple = (v: string, step: string) => new Decimal(v).mod(step).isZero();

describe("snapping (decimal-safe)", () => {
  it("floors bids and ceils asks to the tick", () => {
    expect(snapPrice(100.0149, "0.01", "buy")).toBe("100.01");
    expect(snapPrice(100.0149, "0.01", "sell")).toBe("100.02");
    expect(snapPrice(0.30000000000000004, "0.1", "buy")).toBe("0.3");
    expect(snapPrice(1234.5, "5", "sell")).toBe("1235");
  });

  it("floors quantity to the step", () => {
    expect(snapQuantity(1.23456, "0.001")).toBe("1.234");
    expect(snapQuantity(0.0009, "0.001")).toBe("0");
  });

  it("returns 0 for non-finite or non-positive values", () => {
    expect(snapPrice(Number.NaN, "0.01", "buy")).toBe("0");
    expect(snapPrice(-1, "0.01", "sell")).toBe("0");
  });
});

describe("fair value", () => {
  it("adjusts the oracle toward the microprice when the book is healthy", () => {
    // microprice = (99.9*30 + 100.1*10) / 40 = 99.95: the heavier ask queue pulls it toward the bid
    const fv = computeFairValue(
      { oraclePrice: 100, bids: [{ price: "99.9", quantity: "10" }], asks: [{ price: "100.1", quantity: "30" }] },
      P,
    );
    expect(fv.bookHealthy).toBe(true);
    expect(fv.mid).toBeCloseTo(100, 10);
    expect(fv.microprice).toBeCloseTo(99.95, 10);
    expect(fv.adjustmentBps).toBeCloseTo(-2.5, 6);
    expect(fv.fair).toBeCloseTo(99.975, 6);
  });

  it("caps the microprice adjustment", () => {
    const fv = computeFairValue(
      { oraclePrice: 100, bids: [{ price: "103.9", quantity: "1000" }], asks: [{ price: "104.1", quantity: "1" }] },
      { ...P, bookHealthyMaxSpreadBps: 2_000 },
    );
    expect(fv.adjustmentBps).toBe(P.maxMicropriceAdjBps);
  });

  it("uses the oracle alone when the book is one-sided, crossed or too wide", () => {
    expect(computeFairValue({ oraclePrice: 100, bids: [], asks: [{ price: "100.1", quantity: "1" }] }, P)).toMatchObject({
      fair: 100,
      bookHealthy: false,
      mid: null,
    });
    expect(
      computeFairValue({ oraclePrice: 100, bids: [{ price: "100.2", quantity: "1" }], asks: [{ price: "100.1", quantity: "1" }] }, P)
        .bookHealthy,
    ).toBe(false);
    expect(
      computeFairValue({ oraclePrice: 100, bids: [{ price: "95", quantity: "1" }], asks: [{ price: "105", quantity: "1" }] }, P),
    ).toMatchObject({ fair: 100, bookHealthy: false });
  });
});

describe("EWMA volatility", () => {
  it("starts at the floor and rises with large returns", () => {
    const s0 = updateVolatility(null, 100, 0, P);
    expect(sigmaBps(s0, P)).toBeCloseTo(P.sigmaFloorBps, 10);
    const s1 = updateVolatility(s0, 101, 1_000, P); // ~99.5 bps move in 1 s
    expect(sigmaBps(s1, P)).toBeGreaterThan(5);
  });

  it("decays toward calm with the configured half-life", () => {
    let s = updateVolatility(updateVolatility(null, 100, 0, P), 101, 1_000, P);
    const hot = sigmaBps(s, P);
    s = updateVolatility(s, 101, 1_000 + P.ewmaHalfLifeSec * 1_000, P);
    // one half-life of zero returns halves the variance
    expect(sigmaBps(s, P) ** 2).toBeCloseTo((hot ** 2) / 2, 6);
  });

  it("ignores non-increasing timestamps and bad prices", () => {
    const s0 = updateVolatility(null, 100, 1_000, P);
    expect(updateVolatility(s0, 120, 1_000, P)).toBe(s0);
    expect(updateVolatility(s0, 0, 2_000, P)).toBe(s0);
    expect(sigmaBps(null, P)).toBe(P.sigmaFloorBps);
  });
});

describe("kappa from fill intensity", () => {
  it("returns the prior with no fills and moves toward 1/mean distance with fills", () => {
    expect(estimateKappa(null, P)).toBeCloseTo(P.kappa, 10);
    let k = null;
    for (let i = 0; i < 500; i++) k = updateKappa(k, 10);
    expect(estimateKappa(k, P)).toBeCloseTo(0.1, 1);
  });

  it("clamps to bounds and ignores invalid distances", () => {
    let k = null;
    for (let i = 0; i < 500; i++) k = updateKappa(k, 0);
    expect(estimateKappa(k, { ...P, kappaPriorWeight: 1 })).toBe(50);
    expect(updateKappa(k, Number.NaN)).toBe(k);
  });
});

describe("half spread (Avellaneda-Stoikov)", () => {
  it("matches the closed form above the floor", () => {
    const p = { ...P, minHalfSpreadBps: 1 };
    const expected = (p.gamma * 4 * p.horizonSec) / 2 + (1 / p.gamma) * Math.log(1 + p.gamma / 0.5);
    expect(halfSpreadBps(2, 0.5, p)).toBeCloseTo(expected, 10);
  });
  it("never goes below minHalfSpreadBps", () => {
    expect(halfSpreadBps(0, 50, P)).toBe(P.minHalfSpreadBps);
  });
});

describe("external book", () => {
  it("removes our own resting size from the aggregated levels", () => {
    const ext = externalBook(
      [{ price: "99.9", quantity: "5" }, { price: "99.8", quantity: "2" }],
      [{ price: "100.1", quantity: "1" }],
      [
        { side: "buy", price: "99.9", quantity: "5" },
        { side: "sell", price: "100.1", quantity: "0.4" },
      ],
    );
    expect(ext.bids).toEqual([{ price: "99.8", quantity: "2" }]);
    expect(ext.asks).toEqual([{ price: "100.1", quantity: "0.6" }]);
  });
});

describe("computeQuotes", () => {
  it("builds an N-level ladder with sizes increasing with distance", () => {
    const plan = computeQuotes(baseInput(), P);
    const bids = sideOf(plan.quotes, "buy");
    const asks = sideOf(plan.quotes, "sell");
    expect(bids).toHaveLength(3);
    expect(asks).toHaveLength(3);
    for (let i = 1; i < 3; i++) {
      expect(Number(bids[i]!.price)).toBeLessThan(Number(bids[i - 1]!.price));
      expect(Number(asks[i]!.price)).toBeGreaterThan(Number(asks[i - 1]!.price));
      expect(Number(bids[i]!.quantity)).toBeGreaterThan(Number(bids[i - 1]!.quantity));
      expect(Number(asks[i]!.quantity)).toBeGreaterThan(Number(asks[i - 1]!.quantity));
    }
    expect(plan.quotes.every((q) => !q.reduceOnly)).toBe(true);
  });

  it("quotes symmetric around fair with zero inventory and no funding", () => {
    const plan = computeQuotes(baseInput({ bids: [], asks: [] }), P);
    expect(plan.skewBps).toBe(0);
    const bid = Number(sideOf(plan.quotes, "buy")[0]!.price);
    const ask = Number(sideOf(plan.quotes, "sell")[0]!.price);
    expect(100 - bid).toBeCloseTo(ask - 100, 1);
    expect(ask - bid).toBeGreaterThanOrEqual((2 * P.minHalfSpreadBps * 100) / 1e4 - 0.02);
  });

  it("skews both sides down when long and up when short", () => {
    const flat = computeQuotes(baseInput({ bids: [], asks: [] }), P);
    const long = computeQuotes(baseInput({ bids: [], asks: [], inventoryBase: 1.5 }), P);
    const short = computeQuotes(baseInput({ bids: [], asks: [], inventoryBase: -1.5 }), P);
    expect(long.reservation).toBeLessThan(flat.reservation);
    expect(short.reservation).toBeGreaterThan(flat.reservation);
    expect(Number(sideOf(long.quotes, "sell")[0]!.price)).toBeLessThan(Number(sideOf(flat.quotes, "sell")[0]!.price));
    expect(Number(sideOf(short.quotes, "buy")[0]!.price)).toBeGreaterThan(Number(sideOf(flat.quotes, "buy")[0]!.price));
  });

  it("skews nonlinearly as inventory approaches the cap", () => {
    const at = (usd: number) => computeQuotes(baseInput({ bids: [], asks: [], inventoryBase: usd / 100 }), P).skewBps;
    const s25 = Math.abs(at(50));
    const s50 = Math.abs(at(100));
    const s90 = Math.abs(at(180));
    expect(s50 - s25).toBeLessThan(s90 - s50);
  });

  it("stops quoting the side that grows inventory at the cap", () => {
    const longAtCap = computeQuotes(baseInput({ inventoryBase: 2 }), P); // $200 = cap
    expect(sideOf(longAtCap.quotes, "buy")).toHaveLength(0);
    expect(sideOf(longAtCap.quotes, "sell").length).toBeGreaterThan(0);
    const shortAtCap = computeQuotes(baseInput({ inventoryBase: -2.5 }), P);
    expect(sideOf(shortAtCap.quotes, "sell")).toHaveLength(0);
  });

  it("trims inventory-increasing levels so a full fill stays inside the cap", () => {
    const plan = computeQuotes(baseInput({ bids: [], asks: [], inventoryBase: 1.5 }), P); // $150 of $200
    const buyNotional = sideOf(plan.quotes, "buy").reduce((s, q) => s + Number(q.price) * Number(q.quantity), 0);
    expect(buyNotional).toBeLessThanOrEqual(50 + 1e-9);
  });

  it("skews against paying funding", () => {
    const flat = computeQuotes(baseInput({ bids: [], asks: [] }), P);
    const longsPay = computeQuotes(baseInput({ bids: [], asks: [], fundingRateHourly: 0.0002 }), P); // 2 bps/h
    const shortsPay = computeQuotes(baseInput({ bids: [], asks: [], fundingRateHourly: -0.0002 }), P);
    expect(longsPay.reservation).toBeLessThan(flat.reservation);
    expect(shortsPay.reservation).toBeGreaterThan(flat.reservation);
    expect(longsPay.skewBps).toBeCloseTo(-1, 10);
    const huge = computeQuotes(baseInput({ bids: [], asks: [], fundingRateHourly: 0.5 }), P);
    expect(huge.skewBps).toBe(-P.maxFundingSkewBps);
  });

  it("never crosses the external book even when fair is far through it", () => {
    const plan = computeQuotes(
      baseInput({ fair: 105, bids: [{ price: "99.9", quantity: "10" }], asks: [{ price: "100.1", quantity: "10" }] }),
      P,
    );
    for (const b of sideOf(plan.quotes, "buy")) expect(Number(b.price)).toBeLessThanOrEqual(100.09);
    for (const a of sideOf(plan.quotes, "sell")) expect(Number(a.price)).toBeGreaterThanOrEqual(99.91);
  });

  it("is not blocked by its own resting orders when checking the cross", () => {
    // Our own ask at 100.1 is the whole ask side; the external ask side is empty.
    const plan = computeQuotes(
      baseInput({ fair: 100.2, asks: [{ price: "100.1", quantity: "1" }], ownOrders: [{ side: "sell", price: "100.1", quantity: "1" }] }),
      { ...P, minHalfSpreadBps: 1, levels: 1 },
    );
    expect(Number(sideOf(plan.quotes, "buy")[0]!.price)).toBeGreaterThan(100.1);
  });

  it("keeps at least two ticks between own bid and ask", () => {
    const plan = computeQuotes(
      baseInput({ bids: [], asks: [], market: { tickSize: "1", minQuantity: "0.001", minNotional: "1" } }),
      { ...P, minHalfSpreadBps: 1, levels: 1 },
    );
    const bid = Number(sideOf(plan.quotes, "buy")[0]!.price);
    const ask = Number(sideOf(plan.quotes, "sell")[0]!.price);
    expect(ask - bid).toBeGreaterThanOrEqual(2);
  });

  it("raises quantity to meet min notional and drops levels it cannot price", () => {
    const plan = computeQuotes(
      baseInput({ market: { tickSize: "0.01", minQuantity: "1", minNotional: "500" } }),
      { ...P, baseOrderSizeUsd: 1, levels: 1 },
    );
    for (const q of plan.quotes) expect(Number(q.price) * Number(q.quantity)).toBeGreaterThanOrEqual(500);
    const none = computeQuotes(baseInput({ fair: 0.001, bids: [], asks: [], market: { tickSize: "1", minQuantity: "1", minNotional: "1" } }), P);
    expect(sideOf(none.quotes, "buy")).toHaveLength(0);
    expect(none.dropped.some((d) => d.reason === "non_positive_price")).toBe(true);
  });

  it("applies session multipliers to spread, size and cap", () => {
    const base = computeQuotes(baseInput({ bids: [], asks: [] }), P);
    const wide = computeQuotes(baseInput({ bids: [], asks: [], session: { spreadMultiplier: 4, sizeMultiplier: 0.5, inventoryCapMultiplier: 0.1 } }), P);
    expect(wide.halfSpreadBps).toBeCloseTo(base.halfSpreadBps * 4, 10);
    expect(Number(sideOf(wide.quotes, "sell")[0]!.quantity)).toBeLessThan(Number(sideOf(base.quotes, "sell")[0]!.quantity));
    const capped = computeQuotes(baseInput({ bids: [], asks: [], inventoryBase: 0.3, session: { spreadMultiplier: 1, sizeMultiplier: 1, inventoryCapMultiplier: 0.1 } }), P);
    expect(sideOf(capped.quotes, "buy")).toHaveLength(0); // $30 long vs $20 cap
  });

  it("reduce_only mode quotes only the side that shrinks inventory, marked reduce-only", () => {
    const plan = computeQuotes(baseInput({ inventoryBase: 0.5, mode: "reduce_only" }), P);
    expect(sideOf(plan.quotes, "buy")).toHaveLength(0);
    const asks = sideOf(plan.quotes, "sell");
    expect(asks.length).toBeGreaterThan(0);
    expect(asks.every((q) => q.reduceOnly)).toBe(true);
    const total = asks.reduce((s, q) => s + Number(q.quantity), 0);
    expect(total).toBeLessThanOrEqual(0.5 + 1e-12);
    expect(computeQuotes(baseInput({ mode: "reduce_only" }), P).quotes).toHaveLength(0);
  });

  it("flatten mode posts one reduce-only order for the whole position near fair", () => {
    const plan = computeQuotes(baseInput({ inventoryBase: -0.75, mode: "flatten", bids: [], asks: [] }), P);
    expect(plan.quotes).toHaveLength(1);
    expect(plan.quotes[0]).toMatchObject({ side: "buy", quantity: "0.75", reduceOnly: true, level: 0 });
    expect(Number(plan.quotes[0]!.price)).toBeLessThan(100);
    expect(computeQuotes(baseInput({ mode: "flatten" }), P).quotes).toHaveLength(0);
  });

  it("returns nothing for a non-positive fair value", () => {
    expect(computeQuotes(baseInput({ fair: 0 }), P).quotes).toHaveLength(0);
  });
});

describe("computeQuotes properties", () => {
  const tickArb = fc.constantFrom("0.0001", "0.001", "0.01", "0.05", "0.1", "0.5", "1", "5");
  const stepArb = fc.constantFrom("0.0001", "0.001", "0.01", "0.1", "1");
  const inputArb = fc.record({
    fair: fc.double({ min: 0.5, max: 50_000, noNaN: true }),
    bookOffsetBps: fc.double({ min: -200, max: 200, noNaN: true }),
    bookHalfBps: fc.double({ min: 0.5, max: 300, noNaN: true }),
    hasBids: fc.boolean(),
    hasAsks: fc.boolean(),
    invUsd: fc.double({ min: -400, max: 400, noNaN: true }),
    funding: fc.option(fc.double({ min: -0.01, max: 0.01, noNaN: true }), { nil: null }),
    sigma: fc.double({ min: 0, max: 50, noNaN: true }),
    tick: tickArb,
    step: stepArb,
    gamma: fc.double({ min: 0.001, max: 5, noNaN: true }),
    levels: fc.integer({ min: 1, max: 10 }),
    spacing: fc.double({ min: 0.5, max: 50, noNaN: true }),
    mode: fc.constantFrom<"normal" | "reduce_only" | "flatten">("normal", "reduce_only", "flatten"),
  });

  type Generated = typeof inputArb extends fc.Arbitrary<infer T> ? T : never;
  function build(x: Generated) {
    const mid = x.fair * (1 + x.bookOffsetBps / 1e4);
    const bid = mid * (1 - x.bookHalfBps / 1e4);
    const ask = mid * (1 + x.bookHalfBps / 1e4);
    const params: RiskParams = { ...P, gamma: x.gamma, levels: x.levels, levelSpacingBps: x.spacing };
    const input = baseInput({
      fair: x.fair,
      sigmaBps: x.sigma,
      inventoryBase: x.invUsd / x.fair,
      fundingRateHourly: x.funding,
      bids: x.hasBids ? [{ price: snapPrice(bid, x.tick, "buy"), quantity: "100" }] : [],
      asks: x.hasAsks ? [{ price: snapPrice(ask, x.tick, "sell"), quantity: "100" }] : [],
      market: { tickSize: x.tick, minQuantity: x.step, minNotional: "1" },
      mode: x.mode,
    });
    return { input, params, plan: computeQuotes(input, params) };
  }

  it("never crosses the external book and keeps own bid/ask apart", () => {
    fc.assert(
      fc.property(inputArb, (x) => {
        const { input, plan } = build(x);
        const tick = new Decimal(x.tick);
        const bestBid = input.bids[0] ? new Decimal(input.bids[0].price) : null;
        const bestAsk = input.asks[0] ? new Decimal(input.asks[0].price) : null;
        const bids = sideOf(plan.quotes, "buy").map((q) => new Decimal(q.price));
        const asks = sideOf(plan.quotes, "sell").map((q) => new Decimal(q.price));
        for (const b of bids) if (bestAsk && bestAsk.gt(0)) expect(b.lt(bestAsk)).toBe(true);
        for (const a of asks) if (bestBid && bestBid.gt(0)) expect(a.gt(bestBid)).toBe(true);
        if (bids.length && asks.length) {
          const gap = Decimal.min(...asks).minus(Decimal.max(...bids));
          expect(gap.gte(tick.times(2))).toBe(true);
        }
      }),
      { numRuns: 400 },
    );
  });

  it("every price is a positive tick multiple and every quantity a positive step multiple", () => {
    fc.assert(
      fc.property(inputArb, (x) => {
        const { plan } = build(x);
        for (const q of plan.quotes) {
          expect(new Decimal(q.price).gt(0)).toBe(true);
          expect(new Decimal(q.quantity).gt(0)).toBe(true);
          expect(isMultiple(q.price, x.tick)).toBe(true);
          expect(isMultiple(q.quantity, x.step)).toBe(true);
          expect(q.price).not.toMatch(/e/i);
          expect(q.quantity).not.toMatch(/e/i);
        }
      }),
      { numRuns: 400 },
    );
  });

  it("skew direction always opposes inventory when funding is neutral", () => {
    fc.assert(
      fc.property(inputArb, (x) => {
        const { plan } = build({ ...x, funding: null, mode: "normal" });
        if (x.invUsd > 1e-9) expect(plan.skewBps).toBeLessThanOrEqual(0);
        if (x.invUsd < -1e-9) expect(plan.skewBps).toBeGreaterThanOrEqual(0);
      }),
      { numRuns: 300 },
    );
  });

  it("reduce-only and flatten never increase absolute inventory", () => {
    fc.assert(
      fc.property(inputArb, (x) => {
        const { plan, input } = build({ ...x, mode: x.mode === "normal" ? "reduce_only" : x.mode });
        const inv = input.inventoryBase;
        for (const q of plan.quotes) {
          expect(q.reduceOnly).toBe(true);
          expect(q.side).toBe(inv > 0 ? "sell" : "buy");
        }
        const total = plan.quotes.reduce((s, q) => s.plus(q.quantity), new Decimal(0));
        expect(total.lte(Math.abs(inv) + 1e-12)).toBe(true);
      }),
      { numRuns: 300 },
    );
  });
});

describe("book health (testnet stale-order books)", () => {
  const P2: RiskParams = { ...DEFAULT_PARAMS, bookHealthBandBps: 300, bookHealthMinDepthUsd: 25 };
  it("ignores far-away stale levels and measures depth inside the band", () => {
    const h = assessBook(
      100,
      [{ price: "99.8", quantity: "1" }, { price: "50", quantity: "1000" }],
      [{ price: "100.3", quantity: "0.5" }, { price: "180", quantity: "1000" }],
      P2,
    );
    expect(h.healthy).toBe(true);
    expect(h.mid).toBeCloseTo(100.05, 10);
    expect(h.bidDepthUsd).toBeCloseTo(99.8, 6);
    expect(h.askDepthUsd).toBeCloseTo(50.15, 6);
    expect(h.bids).toEqual([{ price: "99.8", quantity: "1" }]);
  });

  it("is unhealthy when a side has no depth in the band, too little depth, or is crossed", () => {
    expect(assessBook(100, [{ price: "50", quantity: "1000" }], [{ price: "100.2", quantity: "10" }], P2)).toMatchObject({ healthy: false, mid: null, reason: "no_bids_in_band" });
    expect(assessBook(100, [{ price: "99.9", quantity: "10" }], [], P2)).toMatchObject({ healthy: false, reason: "no_asks_in_band" });
    expect(assessBook(100, [{ price: "99.9", quantity: "0.1" }], [{ price: "100.1", quantity: "10" }], P2)).toMatchObject({ healthy: false, reason: "thin_depth" });
    expect(assessBook(100, [{ price: "100.2", quantity: "10" }], [{ price: "100.1", quantity: "10" }], P2)).toMatchObject({ healthy: false, reason: "crossed" });
    expect(assessBook(Number.NaN, [], [], P2)).toMatchObject({ healthy: false, reason: "invalid_oracle" });
  });

  it("property: a healthy mid always lies within the band around the oracle", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 10_000, noNaN: true }),
        fc.array(fc.tuple(fc.double({ min: -0.9, max: 2, noNaN: true }), fc.double({ min: 0.001, max: 100, noNaN: true })), { maxLength: 6 }),
        fc.array(fc.tuple(fc.double({ min: -0.9, max: 2, noNaN: true }), fc.double({ min: 0.001, max: 100, noNaN: true })), { maxLength: 6 }),
        (oracle, b, a) => {
          const lv = (xs: [number, number][]) => xs.map(([off, q]) => ({ price: String(oracle * (1 + off)), quantity: String(q) }));
          const h = assessBook(oracle, lv(b), lv(a), P2);
          if (h.healthy) expect(Math.abs((h.mid! - oracle) / oracle) * 1e4).toBeLessThanOrEqual(P2.bookHealthBandBps + 1e-6);
          else expect(h.mid).toBeNull();
        },
      ),
    );
  });
});
