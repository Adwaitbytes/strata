import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { DEFAULT_PARAMS } from "../src/params.js";
import { INITIAL_ORACLE_STATE, evaluateOracle, type OracleObservation, type OracleGuardState } from "../src/oracleGuard.js";

const P = DEFAULT_PARAMS;
const T0 = 1_780_000_000_000;

function obs(over: Partial<OracleObservation> = {}): OracleObservation {
  return {
    oracle: { price: 100, timestampMs: T0 - 1_000 },
    reference: null,
    chainTimeMs: T0,
    wallClockMs: T0 + 500,
    bookMid: 100.02,
    bookHealthy: true,
    ...over,
  };
}

/** Run a sequence of observations, threading state, and return every result. */
function run(seq: OracleObservation[], state: OracleGuardState = INITIAL_ORACLE_STATE, params = P) {
  const out = [];
  let s = state;
  for (const o of seq) {
    const r = evaluateOracle(o, s, params);
    out.push(r);
    s = r.state;
  }
  return out;
}

describe("oracle guard", () => {
  it("passes a fresh, consistent oracle", () => {
    const r = evaluateOracle(obs(), INITIAL_ORACLE_STATE, P);
    expect(r.action).toBe("ok");
    expect(r.decisions).toEqual([]);
  });

  describe("stale oracle (fixture)", () => {
    it("halts when the report is older than maxOracleAgeSec against chain time", () => {
      const r = evaluateOracle(obs({ oracle: { price: 100, timestampMs: T0 - 41_000 } }), INITIAL_ORACLE_STATE, P);
      expect(r.action).toBe("halt");
      expect(r.decisions[0]).toMatchObject({
        guard: "oracle",
        action: "halt",
        reason: "oracle_stale",
        observed: { oracleAgeSec: 41, limitSec: 30 },
      });
      expect(r.decisions[0]!.detail).toMatch(/41/);
    });

    it("accepts a report exactly at the age limit", () => {
      expect(evaluateOracle(obs({ oracle: { price: 100, timestampMs: T0 - 30_000 } }), INITIAL_ORACLE_STATE, P).action).toBe("ok");
    });
  });

  describe("future-dated oracle (fixture, Ostium lesson)", () => {
    it("halts when the report is newer than chain time + 2 s", () => {
      const r = evaluateOracle(obs({ oracle: { price: 100, timestampMs: T0 + 2_500 } }), INITIAL_ORACLE_STATE, P);
      expect(r.action).toBe("halt");
      expect(r.decisions[0]).toMatchObject({ reason: "oracle_future_timestamp", observed: { aheadSec: 2.5, limitSec: 2 } });
    });

    it("tolerates up to 2 s of clock skew", () => {
      expect(evaluateOracle(obs({ oracle: { price: 100, timestampMs: T0 + 2_000 } }), INITIAL_ORACLE_STATE, P).action).toBe("ok");
    });
  });

  describe("oracle vs book deviation (fixture)", () => {
    const deviated = obs({ bookMid: 102 }); // 200 bps away
    it("halts only after 3 consecutive deviated cycles", () => {
      const r = run([deviated, deviated, deviated]);
      expect(r.map((x) => x.action)).toEqual(["ok", "ok", "halt"]);
      expect(r[2]!.decisions[0]).toMatchObject({ reason: "oracle_book_deviation", observed: { consecutiveCycles: 3 } });
    });

    it("resets the counter when the book comes back inside the band", () => {
      const r = run([deviated, deviated, obs(), deviated, deviated]);
      expect(r.every((x) => x.action === "ok")).toBe(true);
    });

    it("resets the counter on an unhealthy book (no mid) under the widen policy", () => {
      const r = run([deviated, obs({ bookMid: null }), deviated, deviated], INITIAL_ORACLE_STATE, { ...P, unhealthyBookPolicy: "widen" });
      expect(r.map((x) => x.action)).toEqual(["ok", "ok", "ok", "ok"]);
    });
  });

  describe("two-source divergence", () => {
    it("halts when the reference disagrees beyond maxSourceDevBps", () => {
      const r = evaluateOracle(obs({ reference: { price: 101.5, timestampMs: T0 - 500 } }), INITIAL_ORACLE_STATE, P);
      expect(r.action).toBe("halt");
      expect(r.decisions[0]).toMatchObject({ reason: "oracle_source_divergence" });
      expect(r.decisions[0]!.observed["divergenceBps"]).toBeCloseTo(150, 6);
    });

    it("ignores a stale or invalid reference instead of halting on it", () => {
      expect(evaluateOracle(obs({ reference: { price: 150, timestampMs: T0 - 120_000 } }), INITIAL_ORACLE_STATE, P).action).toBe("ok");
      expect(evaluateOracle(obs({ reference: { price: 0, timestampMs: T0 } }), INITIAL_ORACLE_STATE, P).action).toBe("ok");
    });

    it("accepts agreement within the limit", () => {
      expect(evaluateOracle(obs({ reference: { price: 100.5, timestampMs: T0 - 500 } }), INITIAL_ORACLE_STATE, P).action).toBe("ok");
    });
  });

  describe("jump without book move (fixture)", () => {
    it("halts when the oracle jumps beyond maxJumpBps and the book does not follow", () => {
      const r = run([obs(), obs({ oracle: { price: 104, timestampMs: T0 + 1_000 }, chainTimeMs: T0 + 1_500, wallClockMs: T0 + 1_500, bookMid: 100.05 })]);
      expect(r[1]!.action).toBe("halt");
      expect(r[1]!.decisions.map((d) => d.reason)).toContain("oracle_jump");
    });

    it("accepts a jump the book confirms", () => {
      const r = run([obs(), obs({ oracle: { price: 104, timestampMs: T0 + 1_000 }, chainTimeMs: T0 + 1_500, wallClockMs: T0 + 1_500, bookMid: 103.98 })]);
      expect(r[1]!.action).toBe("ok");
    });

    it("halts on a jump with no book to confirm it", () => {
      const r = run([obs(), obs({ oracle: { price: 96, timestampMs: T0 + 1_000 }, chainTimeMs: T0 + 1_500, wallClockMs: T0 + 1_500, bookMid: null })]);
      expect(r[1]!.decisions.map((d) => d.reason)).toContain("oracle_jump");
    });
  });

  it("halts on unusable data", () => {
    const bad = [
      obs({ oracle: { price: 0, timestampMs: T0 } }),
      obs({ oracle: { price: Number.NaN, timestampMs: T0 } }),
      obs({ oracle: { price: 100, timestampMs: Number.NaN } }),
      obs({ chainTimeMs: Number.NaN }),
    ];
    for (const b of bad) {
      const r = evaluateOracle(b, INITIAL_ORACLE_STATE, P);
      expect(r.action).toBe("halt");
      expect(r.decisions[0]!.reason).toBe("data_unavailable");
    }
  });

  describe("unhealthy book policy", () => {
    const unhealthy = obs({ bookMid: null, bookHealthy: false, bookDiagnostics: { bidDepthUsd: 0, askDepthUsd: 12 } });
    it("widen: skips the cross-check and widens instead of halting, every cycle", () => {
      const W = { ...P, unhealthyBookPolicy: "widen" as const };
      let s = INITIAL_ORACLE_STATE;
      for (let i = 0; i < 5; i++) {
        const r = evaluateOracle(unhealthy, s, W);
        expect(r.action).toBe("ok");
        expect(r.spreadMultiplier).toBe(2);
        expect(r.decisions[0]).toMatchObject({ action: "widen", reason: "oracle_book_deviation", observed: { bookHealthy: false, askDepthUsd: 12 } });
        expect(r.decisions[0]!.detail).toBe("Book unhealthy, cross-check skipped, spreads widened.");
        s = r.state;
      }
      expect(s.consecutiveDevCycles).toBe(0);
    });
    it("halt: halts on an unhealthy book (mainnet default)", () => {
      expect(P.unhealthyBookPolicy).toBe("halt");
      const r = evaluateOracle(unhealthy, INITIAL_ORACLE_STATE, P);
      expect(r.action).toBe("halt");
      expect(r.decisions[0]).toMatchObject({ reason: "oracle_book_deviation" });
    });
    it("widen never masks staleness, future timestamps or source divergence", () => {
      const W = { ...P, unhealthyBookPolicy: "widen" as const };
      expect(evaluateOracle({ ...unhealthy, oracle: { price: 100, timestampMs: T0 - 60_000 } }, INITIAL_ORACLE_STATE, W).action).toBe("halt");
      expect(evaluateOracle({ ...unhealthy, oracle: { price: 100, timestampMs: T0 + 9_000 } }, INITIAL_ORACLE_STATE, W).action).toBe("halt");
      expect(evaluateOracle({ ...unhealthy, reference: { price: 105, timestampMs: T0 } }, INITIAL_ORACLE_STATE, W).action).toBe("halt");
    });
    it("widen never masks an unconfirmed jump", () => {
      const W = { ...P, unhealthyBookPolicy: "widen" as const };
      const first = evaluateOracle(unhealthy, INITIAL_ORACLE_STATE, W);
      const r = evaluateOracle({ ...unhealthy, oracle: { price: 104, timestampMs: T0 + 1_000 }, chainTimeMs: T0 + 1_500, wallClockMs: T0 + 1_500 }, first.state, W);
      expect(r.action).toBe("halt");
      expect(r.decisions.map((d) => d.reason)).toContain("oracle_jump");
    });
    it("property: with widen, an unhealthy book never produces a deviation halt", () => {
      const W = { ...P, unhealthyBookPolicy: "widen" as const };
      fc.assert(
        fc.property(fc.array(fc.double({ min: 1, max: 1e6, noNaN: true }), { minLength: 1, maxLength: 10 }), (mids) => {
          let s = INITIAL_ORACLE_STATE;
          for (const m of mids) {
            const r = evaluateOracle(obs({ bookMid: m, bookHealthy: false }), s, W);
            expect(r.decisions.some((d) => d.reason === "oracle_book_deviation" && d.action === "halt")).toBe(false);
            s = r.state;
          }
        }),
      );
    });
  });

  describe("chain lag (M-3)", () => {
    it("halts when chain time lags the wall clock beyond maxChainLagSec, even if the oracle is fresh against chain", () => {
      const r = evaluateOracle(obs({ oracle: { price: 100, timestampMs: T0 - 1_000 }, wallClockMs: T0 + 60_000 }), INITIAL_ORACLE_STATE, P);
      expect(r.action).toBe("halt");
      expect(r.decisions[0]).toMatchObject({ reason: "data_unavailable", observed: { chainLagSec: 60, limitSec: P.maxChainLagSec } });
    });
    it("accepts a small lag and a chain slightly ahead of the host clock", () => {
      expect(evaluateOracle(obs({ wallClockMs: T0 + 9_000 }), INITIAL_ORACLE_STATE, P).action).toBe("ok");
      expect(evaluateOracle(obs({ wallClockMs: T0 - 3_000 }), INITIAL_ORACLE_STATE, P).action).toBe("ok");
    });
    it("fails closed on an invalid wall clock", () => {
      expect(evaluateOracle(obs({ wallClockMs: Number.NaN }), INITIAL_ORACLE_STATE, P).decisions[0]!.reason).toBe("data_unavailable");
    });
  });

  describe("reference policy (L-3)", () => {
    const missing = [null, { price: 100, timestampMs: T0 - 120_000 }, { price: 100, timestampMs: T0 + 10_000 }, { price: Number.NaN, timestampMs: T0 }];
    it("ignores a missing reference when no reference is configured", () => {
      for (const ref of missing) expect(evaluateOracle(obs({ reference: ref }), INITIAL_ORACLE_STATE, P)).toMatchObject({ action: "ok", spreadMultiplier: 1 });
    });
    it("widens when the policy is widen", () => {
      for (const ref of missing) {
        const r = evaluateOracle(obs({ reference: ref }), INITIAL_ORACLE_STATE, { ...P, referencePolicy: "widen" });
        expect(r.action).toBe("ok");
        expect(r.spreadMultiplier).toBe(2);
        expect(r.decisions[0]).toMatchObject({ action: "widen", reason: "oracle_source_divergence" });
      }
    });
    it("halts when the policy is halt", () => {
      for (const ref of missing) {
        const r = evaluateOracle(obs({ reference: ref }), INITIAL_ORACLE_STATE, { ...P, referencePolicy: "halt" });
        expect(r.action).toBe("halt");
        expect(r.decisions[0]!.detail).toMatch(/[Rr]eference/);
      }
    });
    it("a valid reference passes under every policy", () => {
      for (const referencePolicy of ["none", "widen", "halt"] as const) {
        expect(evaluateOracle(obs({ reference: { price: 100.1, timestampMs: T0 - 500 } }), INITIAL_ORACLE_STATE, { ...P, referencePolicy })).toMatchObject({
          action: "ok",
          spreadMultiplier: 1,
        });
      }
    });
  });

  it("holds a halt for oracleHaltHoldSec, then emits resume", () => {
    const stale = obs({ oracle: { price: 100, timestampMs: T0 - 60_000 } });
    const fresh = (t: number) => obs({ oracle: { price: 100, timestampMs: t - 500 }, chainTimeMs: t, wallClockMs: t });
    const r = run([stale, fresh(T0 + 10_000), fresh(T0 + 31_000)]);
    expect(r[0]!.action).toBe("halt");
    expect(r[1]!.action).toBe("halt");
    expect(r[1]!.decisions[0]).toMatchObject({ reason: "oracle_stale", observed: { holdRemainingSec: 20 } });
    expect(r[2]!.action).toBe("resume");
    expect(r[2]!.decisions[0]).toMatchObject({ action: "resume", reason: "oracle_stale" });
    expect(r[2]!.state.haltReason).toBeNull();
  });

  it("does not mutate the input state", () => {
    const state: OracleGuardState = { ...INITIAL_ORACLE_STATE };
    const frozen = Object.freeze({ ...state });
    evaluateOracle(obs({ bookMid: 103 }), frozen, P);
    expect(frozen).toEqual(state);
  });

  it("property: any report older than the limit or beyond the future skew halts", () => {
    fc.assert(
      fc.property(fc.integer({ min: -600_000, max: 600_000 }), (offsetMs) => {
        const r = evaluateOracle(obs({ oracle: { price: 100, timestampMs: T0 + offsetMs } }), INITIAL_ORACLE_STATE, P);
        const bad = offsetMs > P.maxFutureSkewSec * 1_000 || -offsetMs > P.maxOracleAgeSec * 1_000;
        expect(r.action === "halt").toBe(bad);
      }),
    );
  });
});
