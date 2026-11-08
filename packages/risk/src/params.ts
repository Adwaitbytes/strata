/**
 * Typed risk and quoting parameters with hard min/max bounds (PRD 9.3: "All parameters live in a
 * typed config with min/max bounds. The engine clamps any value outside bounds and logs it").
 *
 * Unit conventions (the whole engine works in basis points of the fair price):
 * - sigma is in bps per sqrt(second), T (`horizonSec`) in seconds, so gamma * sigma^2 * T is bps.
 * - gamma is in 1/bps, kappa is the fill-intensity decay in 1/bps (lambda(d) = A * exp(-kappa * d)).
 * - Inventory q is normalized: position notional / effective inventory cap, so q = 1 means at cap.
 */
import { z } from "zod";

export interface ParamBound {
  readonly min: number;
  readonly max: number;
  readonly integer?: boolean;
}

const num = z.number();

export const RiskParams = z.object({
  /* Quoting engine (9.3) */
  gamma: num,
  kappa: num,
  minHalfSpreadBps: num,
  horizonSec: num,
  levels: num,
  levelSpacingBps: num,
  baseOrderSizeUsd: num,
  sizeMultiplier: num,
  levelSizeGrowth: num,
  ewmaHalfLifeSec: num,
  sigmaFloorBps: num,
  kappaPriorWeight: num,
  inventoryCapUsd: num,
  capSkewBps: num,
  fundingSkewFactor: num,
  maxFundingSkewBps: num,
  micropriceWeight: num,
  maxMicropriceAdjBps: num,
  bookHealthyMaxSpreadBps: num,
  /** Book levels further than this from the oracle are ignored for fair value and the cross-check. */
  bookHealthBandBps: num,
  /** Minimum USD depth per side inside the band for the book to count as healthy. */
  bookHealthMinDepthUsd: num,
  /**
   * Unhealthy book (no two-sided depth near the oracle, e.g. testnet books full of stale far orders):
   * halt = stop quoting (mainnet default), widen = skip the oracle-vs-book cross-check and double spreads.
   * Staleness, future-timestamp, jump and two-source checks still halt either way.
   */
  unhealthyBookPolicy: z.enum(["halt", "widen"]),
  /* Oracle guard (9.4) */
  maxOracleAgeSec: num,
  maxFutureSkewSec: num,
  maxOracleBookDevBps: num,
  oracleBookDevCycles: num,
  maxSourceDevBps: num,
  maxJumpBps: num,
  oracleHaltHoldSec: num,
  /** Max lag of chain time behind the host wall clock before halting (stale node, M-3). */
  maxChainLagSec: num,
  /**
   * What to do when the independent reference price is missing, stale or future-dated:
   * none = no reference configured for this market, widen = spreads x2, halt = stop quoting.
   */
  referencePolicy: z.enum(["none", "widen", "halt"]),
  /* Session guard (9.5) */
  preCloseWidenMin: num,
  preCloseFlattenMin: num,
  preCloseSpreadMultiplier: num,
  preCloseSizeMultiplier: num,
  offHoursQuoting: z.boolean(),
  offHoursSpreadMultiplier: num,
  offHoursSizeMultiplier: num,
  offHoursInventoryCapFraction: num,
  reopenCooldownSec: num,
  rampMinutes: num,
  rampStartSizeFraction: num,
  /* Risk governor (9.6) */
  maxGrossNotionalUsd: num,
  maxNetNotionalUsd: num,
  maxDailyLossUsd: num,
  maxDrawdownUsd: num,
  maxOrdersPerMinute: num,
  minMarginRatio: num,
  criticalMarginRatio: num,
  /* Loop cadence (9.2 step 7) */
  minCycleMs: num,
  maxCycleMs: num,
  highVolSigmaBps: num,
});
export type RiskParams = z.infer<typeof RiskParams>;

export type NumericParamKey = { [K in keyof RiskParams]: RiskParams[K] extends number ? K : never }[keyof RiskParams];

/** Non-numeric parameters (booleans and enums); validated by the schema, not clamped. */
export type ChoiceParamKey = Exclude<keyof RiskParams, NumericParamKey>;

export const PARAM_BOUNDS: Readonly<Record<NumericParamKey, ParamBound>> = {
  gamma: { min: 0.001, max: 5 },
  kappa: { min: 0.01, max: 50 },
  minHalfSpreadBps: { min: 1, max: 500 },
  horizonSec: { min: 1, max: 3_600 },
  levels: { min: 1, max: 10, integer: true },
  levelSpacingBps: { min: 0.5, max: 200 },
  baseOrderSizeUsd: { min: 1, max: 50_000 },
  sizeMultiplier: { min: 0.1, max: 5 },
  levelSizeGrowth: { min: 1, max: 3 },
  ewmaHalfLifeSec: { min: 5, max: 3_600 },
  sigmaFloorBps: { min: 0.01, max: 100 },
  kappaPriorWeight: { min: 1, max: 10_000 },
  inventoryCapUsd: { min: 10, max: 1_000_000 },
  capSkewBps: { min: 0, max: 200 },
  fundingSkewFactor: { min: 0, max: 5 },
  maxFundingSkewBps: { min: 0, max: 100 },
  micropriceWeight: { min: 0, max: 1 },
  maxMicropriceAdjBps: { min: 0, max: 100 },
  bookHealthyMaxSpreadBps: { min: 1, max: 2_000 },
  bookHealthBandBps: { min: 10, max: 5_000 },
  bookHealthMinDepthUsd: { min: 0, max: 1_000_000 },
  maxOracleAgeSec: { min: 1, max: 300 },
  maxFutureSkewSec: { min: 0, max: 10 },
  maxOracleBookDevBps: { min: 10, max: 2_000 },
  oracleBookDevCycles: { min: 1, max: 20, integer: true },
  maxSourceDevBps: { min: 5, max: 2_000 },
  maxJumpBps: { min: 10, max: 5_000 },
  oracleHaltHoldSec: { min: 0, max: 3_600 },
  maxChainLagSec: { min: 2, max: 300 },
  preCloseWidenMin: { min: 1, max: 240 },
  preCloseFlattenMin: { min: 1, max: 60 },
  preCloseSpreadMultiplier: { min: 1, max: 10 },
  preCloseSizeMultiplier: { min: 0.05, max: 1 },
  offHoursSpreadMultiplier: { min: 1, max: 20 },
  offHoursSizeMultiplier: { min: 0.01, max: 1 },
  offHoursInventoryCapFraction: { min: 0.01, max: 1 },
  reopenCooldownSec: { min: 0, max: 3_600 },
  rampMinutes: { min: 1, max: 120 },
  rampStartSizeFraction: { min: 0.01, max: 1 },
  maxGrossNotionalUsd: { min: 10, max: 10_000_000 },
  maxNetNotionalUsd: { min: 10, max: 10_000_000 },
  maxDailyLossUsd: { min: 1, max: 1_000_000 },
  maxDrawdownUsd: { min: 1, max: 1_000_000 },
  maxOrdersPerMinute: { min: 1, max: 1_200, integer: true },
  minMarginRatio: { min: 1.05, max: 20 },
  criticalMarginRatio: { min: 1, max: 20 },
  minCycleMs: { min: 500, max: 10_000 },
  maxCycleMs: { min: 1_000, max: 30_000 },
  highVolSigmaBps: { min: 0.1, max: 1_000 },
};

/** Conservative defaults. Mainnet agent configs tighten the risk limits further (D6, D27). */
export const DEFAULT_PARAMS: RiskParams = {
  gamma: 0.1,
  kappa: 0.5,
  minHalfSpreadBps: 10,
  horizonSec: 60,
  levels: 3,
  levelSpacingBps: 5,
  baseOrderSizeUsd: 25,
  sizeMultiplier: 1,
  levelSizeGrowth: 1.5,
  ewmaHalfLifeSec: 60,
  sigmaFloorBps: 0.5,
  kappaPriorWeight: 20,
  inventoryCapUsd: 200,
  capSkewBps: 20,
  fundingSkewFactor: 0.5,
  maxFundingSkewBps: 25,
  micropriceWeight: 0.5,
  maxMicropriceAdjBps: 20,
  bookHealthyMaxSpreadBps: 100,
  bookHealthBandBps: 300,
  bookHealthMinDepthUsd: 25,
  unhealthyBookPolicy: "halt",
  maxOracleAgeSec: 30,
  maxFutureSkewSec: 2,
  maxOracleBookDevBps: 150,
  oracleBookDevCycles: 3,
  maxSourceDevBps: 100,
  maxJumpBps: 300,
  oracleHaltHoldSec: 30,
  maxChainLagSec: 10,
  referencePolicy: "none",
  preCloseWidenMin: 30,
  preCloseFlattenMin: 5,
  preCloseSpreadMultiplier: 2,
  preCloseSizeMultiplier: 0.5,
  offHoursQuoting: false,
  offHoursSpreadMultiplier: 4,
  offHoursSizeMultiplier: 0.1,
  offHoursInventoryCapFraction: 0.1,
  reopenCooldownSec: 120,
  rampMinutes: 10,
  rampStartSizeFraction: 0.1,
  maxGrossNotionalUsd: 1_000,
  maxNetNotionalUsd: 250,
  maxDailyLossUsd: 50,
  maxDrawdownUsd: 150,
  maxOrdersPerMinute: 120,
  minMarginRatio: 1.5,
  criticalMarginRatio: 1.15,
  minCycleMs: 1_000,
  maxCycleMs: 3_000,
  highVolSigmaBps: 5,
};

export interface ClampedField {
  readonly field: NumericParamKey;
  readonly from: number;
  readonly to: number;
}

export interface ClampResult {
  readonly params: RiskParams;
  readonly clamped: readonly ClampedField[];
}

export function clampValue(key: NumericParamKey, value: number): number {
  const b = PARAM_BOUNDS[key];
  if (Number.isNaN(value)) return DEFAULT_PARAMS[key];
  const rounded = b.integer ? Math.round(value) : value;
  return Math.min(b.max, Math.max(b.min, rounded));
}

/** Clamp every numeric parameter into bounds. Returns the clamped fields so callers can log them. */
export function clampParams(input: RiskParams): ClampResult {
  const params: RiskParams = { ...input };
  const clamped: ClampedField[] = [];
  for (const key of Object.keys(PARAM_BOUNDS) as NumericParamKey[]) {
    const from = input[key];
    const to = clampValue(key, from);
    if (!Object.is(to, from)) {
      params[key] = to;
      clamped.push({ field: key, from, to });
    }
  }
  return { params, clamped };
}
