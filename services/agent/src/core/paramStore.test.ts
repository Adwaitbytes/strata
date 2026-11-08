import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS } from "@strata/risk";
import { ParamStore } from "./paramStore.js";

describe("ParamStore", () => {
  it("clamps the base config on construction and reports clamped fields", () => {
    const store = new ParamStore({ ...DEFAULT_PARAMS, gamma: 99 });
    expect(store.get().gamma).toBe(5);
    expect(store.initialClamps.map((c) => c.field)).toEqual(["gamma"]);
  });

  it("exposes and applies tunable params through the same bounds", () => {
    const store = new ParamStore(DEFAULT_PARAMS);
    expect(store.tunable()).toEqual({ gamma: 0.1, minHalfSpreadBps: 10, levels: 3, sizeMultiplier: 1, offHoursQuoting: false });
    const clamped = store.applyTunable({ gamma: 0.12, minHalfSpreadBps: 9999, levels: 4, sizeMultiplier: 1.1, offHoursQuoting: false });
    expect(clamped.map((c) => c.field)).toEqual(["minHalfSpreadBps"]);
    expect(store.get()).toMatchObject({ gamma: 0.12, minHalfSpreadBps: 500, levels: 4, sizeMultiplier: 1.1 });
  });
});
