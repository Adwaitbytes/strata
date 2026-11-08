import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { DEFAULT_PARAMS, PARAM_BOUNDS, RiskParams, clampParams, type NumericParamKey } from "../src/params.js";

const numericKeys = Object.keys(PARAM_BOUNDS) as NumericParamKey[];

describe("params", () => {
  it("defaults are inside their bounds and pass the schema", () => {
    expect(RiskParams.parse(DEFAULT_PARAMS)).toEqual(DEFAULT_PARAMS);
    const { clamped } = clampParams(DEFAULT_PARAMS);
    expect(clamped).toEqual([]);
  });

  it("uses the PRD defaults for guard parameters", () => {
    expect(DEFAULT_PARAMS.levels).toBe(3);
    expect(DEFAULT_PARAMS.maxOracleAgeSec).toBe(30);
    expect(DEFAULT_PARAMS.maxFutureSkewSec).toBe(2);
    expect(DEFAULT_PARAMS.maxOracleBookDevBps).toBe(150);
    expect(DEFAULT_PARAMS.oracleBookDevCycles).toBe(3);
    expect(DEFAULT_PARAMS.reopenCooldownSec).toBe(120);
    expect(DEFAULT_PARAMS.rampMinutes).toBe(10);
    expect(DEFAULT_PARAMS.offHoursQuoting).toBe(false);
    expect(DEFAULT_PARAMS.offHoursSpreadMultiplier).toBe(4);
    expect(DEFAULT_PARAMS.offHoursInventoryCapFraction).toBe(0.1);
    expect(DEFAULT_PARAMS.preCloseSpreadMultiplier).toBe(2);
    expect(DEFAULT_PARAMS.preCloseSizeMultiplier).toBe(0.5);
  });

  it("clamps values above max and below min and reports each field", () => {
    const { params, clamped } = clampParams({ ...DEFAULT_PARAMS, gamma: 1e9, minHalfSpreadBps: -4 });
    expect(params.gamma).toBe(PARAM_BOUNDS.gamma.max);
    expect(params.minHalfSpreadBps).toBe(PARAM_BOUNDS.minHalfSpreadBps.min);
    expect(clamped).toEqual([
      { field: "gamma", from: 1e9, to: PARAM_BOUNDS.gamma.max },
      { field: "minHalfSpreadBps", from: -4, to: PARAM_BOUNDS.minHalfSpreadBps.min },
    ]);
  });

  it("rounds integer parameters and treats NaN as the default", () => {
    const { params, clamped } = clampParams({ ...DEFAULT_PARAMS, levels: 2.6, gamma: Number.NaN });
    expect(params.levels).toBe(3);
    expect(params.gamma).toBe(DEFAULT_PARAMS.gamma);
    expect(clamped.map((c) => c.field).sort()).toEqual(["gamma", "levels"]);
  });

  it("property: every clamped numeric value lies inside its bounds", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...numericKeys),
        fc.oneof(fc.double({ noNaN: false }), fc.integer()),
        (key, value) => {
          const { params } = clampParams({ ...DEFAULT_PARAMS, [key]: value });
          const b = PARAM_BOUNDS[key];
          const v = params[key];
          expect(Number.isFinite(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(b.min);
          expect(v).toBeLessThanOrEqual(b.max);
          if (b.integer) expect(Number.isInteger(v)).toBe(true);
        },
      ),
    );
  });

  it("property: clamping is idempotent", () => {
    fc.assert(
      fc.property(fc.constantFrom(...numericKeys), fc.double(), (key, value) => {
        const once = clampParams({ ...DEFAULT_PARAMS, [key]: value }).params;
        const twice = clampParams(once);
        expect(twice.params).toEqual(once);
        expect(twice.clamped).toEqual([]);
      }),
    );
  });
});
