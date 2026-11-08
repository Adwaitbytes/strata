/**
 * Holds the live RiskParams for one market. Every write goes through `clampParams`, so neither a
 * config file nor the AI tuner can push a value outside the @strata/risk bounds.
 */
import type { TunableParams } from "@strata/sdk";
import { clampParams, type ClampedField, type RiskParams } from "@strata/risk";

export class ParamStore {
  #params: RiskParams;
  readonly initialClamps: readonly ClampedField[];

  constructor(base: RiskParams) {
    const { params, clamped } = clampParams(base);
    this.#params = params;
    this.initialClamps = clamped;
  }

  get(): RiskParams {
    return this.#params;
  }

  tunable(): TunableParams {
    const { gamma, minHalfSpreadBps, levels, sizeMultiplier, offHoursQuoting } = this.#params;
    return { gamma, minHalfSpreadBps, levels, sizeMultiplier, offHoursQuoting };
  }

  applyTunable(next: TunableParams): readonly ClampedField[] {
    const { params, clamped } = clampParams({ ...this.#params, ...next });
    this.#params = params;
    return clamped;
  }
}
