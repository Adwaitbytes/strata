import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { MAINNET_CAPITAL_CAP_USD } from "@strata/config";
import { DEFAULT_PARAMS, type RiskParams } from "../src/params.js";
import {
  INITIAL_RISK_STATE,
  assertMainnetCaps,
  evaluateRisk,
  recordOrders,
  resetSeasonStop,
  type RiskInput,
  type RiskState,
} from "../src/riskGovernor.js";

const P: RiskParams = { ...DEFAULT_PARAMS, maxGrossNotionalUsd: 1_000, maxNetNotionalUsd: 250, maxDailyLossUsd: 50, maxDrawdownUsd: 150 };
const DAY1 = Date.UTC(2026, 10, 9, 12);
const DAY2 = Date.UTC(2026, 10, 10, 12);
const A = "mkt-a";
const B = "mkt-b";

function input(over: Partial<RiskInput> = {}): RiskInput {
  return {
    nowMs: DAY1,
    equityUsd: 1_000,
    positions: [
      { marketId: A, quantityBase: 1, markPrice: 100 },
      { marketId: B, quantityBase: 0, markPrice: 50 },
    ],
    marginRatio: 5,
    ...over,
  };
}

function step(state: RiskState, over: Partial<RiskInput> = {}) {
  return evaluateRisk(input(over), state, P);
}

describe("risk governor", () => {
  it("allows normal quoting inside every limit", () => {
    const { result, state } = step(INITIAL_RISK_STATE);
    expect(result.haltAll).toBe(false);
    expect(result.markets).toEqual({ [A]: "normal", [B]: "normal" });
    expect(result.decisions).toEqual([]);
    expect(result.orderBudget).toBe(P.maxOrdersPerMinute);
    expect(state.dayStartEquityUsd).toBe(1_000);
    expect(state.peakEquityUsd).toBe(1_000);
  });

  it("blocks inventory increases everywhere above max gross notional", () => {
    const { result } = step(INITIAL_RISK_STATE, {
      positions: [
        { marketId: A, quantityBase: 6, markPrice: 100 },
        { marketId: B, quantityBase: -10, markPrice: 50 },
      ],
    });
    expect(result.markets).toEqual({ [A]: "reduce_only", [B]: "reduce_only" });
    expect(result.decisions[0]).toMatchObject({ marketId: null, decision: { guard: "risk", action: "reduce", reason: "risk_gross_notional" } });
  });

  it("blocks increases on one market above max net notional", () => {
    const { result } = step(INITIAL_RISK_STATE, { positions: [{ marketId: A, quantityBase: -3, markPrice: 100 }, { marketId: B, quantityBase: 1, markPrice: 50 }] });
    expect(result.markets).toEqual({ [A]: "reduce_only", [B]: "normal" });
    expect(result.decisions[0]).toMatchObject({ marketId: A, decision: { reason: "risk_net_notional" } });
  });

  it("stops for the day on max daily loss and resumes the next UTC day", () => {
    const s1 = step(INITIAL_RISK_STATE).state;
    const hit = step(s1, { equityUsd: 949, nowMs: DAY1 + 3_600_000 });
    expect(hit.result.haltAll).toBe(true);
    expect(hit.result.closePositions).toBe(true);
    expect(hit.result.decisions[0]).toMatchObject({ decision: { action: "halt", reason: "risk_daily_loss" } });
    // still stopped later the same day even if equity recovers
    const later = step(hit.state, { equityUsd: 1_000, nowMs: DAY1 + 7_200_000 });
    expect(later.result.haltAll).toBe(true);
    // a new day resets the daily stop and the day-start equity
    const next = step(later.state, { equityUsd: 960, nowMs: DAY2 });
    expect(next.result.haltAll).toBe(false);
    expect(next.state.dayStartEquityUsd).toBe(960);
  });

  it("stops for the season on max drawdown from peak until a human resets it", () => {
    let s = step(INITIAL_RISK_STATE, { equityUsd: 1_100 }).state;
    s = step(s, { equityUsd: 1_120, nowMs: DAY2 }).state; // new day, new peak
    const dd = step(s, { equityUsd: 970, nowMs: DAY2 + 1 });
    expect(dd.result.haltAll).toBe(true);
    expect(dd.result.decisions.map((d) => d.decision.reason)).toContain("risk_max_drawdown");
    const nextDay = step(dd.state, { equityUsd: 1_200, nowMs: DAY2 + 86_400_000 });
    expect(nextDay.result.haltAll).toBe(true);
    const reset = resetSeasonStop(nextDay.state);
    expect(step(reset, { equityUsd: 1_200, nowMs: DAY2 + 86_400_001 }).result.haltAll).toBe(false);
  });

  it("flattens below minMarginRatio and closes below the critical ratio (margin breach fixture)", () => {
    const low = step(INITIAL_RISK_STATE, { marginRatio: 1.3 });
    expect(low.result.markets[A]).toBe("flatten");
    expect(low.result.markets[B]).toBe("halt");
    expect(low.result.closePositions).toBe(false);
    expect(low.result.decisions[0]).toMatchObject({ decision: { action: "reduce", reason: "risk_margin_ratio", observed: { marginRatio: 1.3 } } });

    const critical = step(INITIAL_RISK_STATE, { marginRatio: 1.1 });
    expect(critical.result.closePositions).toBe(true);
    expect(critical.result.haltAll).toBe(true);
    expect(critical.result.decisions[0]).toMatchObject({ decision: { action: "flatten", reason: "risk_margin_ratio" } });
  });

  it("enforces the order rate with a rolling one-minute budget", () => {
    let s = step(INITIAL_RISK_STATE).state;
    s = recordOrders(s, P.maxOrdersPerMinute - 5, DAY1);
    expect(step(s, { nowMs: DAY1 + 1_000 }).result.orderBudget).toBe(5);
    s = recordOrders(s, 10, DAY1 + 1_000);
    const throttled = step(s, { nowMs: DAY1 + 2_000 });
    expect(throttled.result.orderBudget).toBe(0);
    expect(throttled.result.decisions[0]).toMatchObject({ decision: { reason: "risk_order_rate", action: "reduce" } });
    // a minute later the window has rolled
    expect(step(throttled.state, { nowMs: DAY1 + 62_000 }).result.orderBudget).toBe(P.maxOrdersPerMinute);
  });

  it("fails closed on a non-finite mark price or quantity (L-2)", () => {
    for (const bad of [
      { marketId: A, quantityBase: 1, markPrice: Number.NaN },
      { marketId: A, quantityBase: Number.POSITIVE_INFINITY, markPrice: 100 },
    ]) {
      const { result } = step(INITIAL_RISK_STATE, { positions: [bad, { marketId: B, quantityBase: 0, markPrice: 50 }] });
      expect(result.haltAll).toBe(true);
      expect(result.decisions[0]).toMatchObject({ decision: { reason: "data_unavailable" } });
    }
  });

  it("fails closed when the margin ratio is unknown while a position is open (L-2)", () => {
    expect(step(INITIAL_RISK_STATE, { marginRatio: null }).result.haltAll).toBe(true);
    expect(step(INITIAL_RISK_STATE, { marginRatio: Number.NaN }).result.haltAll).toBe(true);
    const flat = step(INITIAL_RISK_STATE, { marginRatio: null, positions: [{ marketId: A, quantityBase: 0, markPrice: 100 }] });
    expect(flat.result.haltAll).toBe(false);
  });

  it("halts when equity is not a finite number", () => {
    const { result } = step(INITIAL_RISK_STATE, { equityUsd: Number.NaN });
    expect(result.haltAll).toBe(true);
    expect(result.decisions[0]).toMatchObject({ decision: { guard: "risk", reason: "data_unavailable" } });
  });

  it("property: the season stop is sticky across any later equity path", () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: 0, max: 10_000, noNaN: true }), { minLength: 1, maxLength: 30 }), (path) => {
        let s = step(INITIAL_RISK_STATE, { equityUsd: 1_000 }).state;
        s = step(s, { equityUsd: 800, nowMs: DAY1 + 1 }).state;
        expect(s.stoppedForSeason).toBe(true);
        path.forEach((eq, i) => {
          const r = step(s, { equityUsd: eq, nowMs: DAY1 + 2 + i * 86_400_000 });
          expect(r.result.haltAll).toBe(true);
          s = r.state;
        });
      }),
    );
  });
});

describe("mainnet hard cap (D6)", () => {
  it("refuses a mainnet config above MAINNET_CAPITAL_CAP_USD", () => {
    expect(() => assertMainnetCaps({ network: "mainnet", capitalUsd: MAINNET_CAPITAL_CAP_USD + 1, params: P })).toThrow(/MAINNET_CAPITAL_CAP_USD/);
    expect(() =>
      assertMainnetCaps({ network: "mainnet", capitalUsd: 500, params: { ...P, maxGrossNotionalUsd: MAINNET_CAPITAL_CAP_USD * 2 } }),
    ).toThrow(/maxGrossNotionalUsd/);
    expect(() => assertMainnetCaps({ network: "mainnet", capitalUsd: 500, params: { ...P, maxDailyLossUsd: 600 } })).toThrow(/maxDailyLossUsd/);
  });

  it("accepts a mainnet config within the cap and any testnet config", () => {
    expect(() => assertMainnetCaps({ network: "mainnet", capitalUsd: 500, params: P })).not.toThrow();
    expect(() => assertMainnetCaps({ network: "testnet", capitalUsd: 1e6, params: { ...P, maxGrossNotionalUsd: 1e6 } })).not.toThrow();
  });
});
