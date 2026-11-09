/**
 * Options-writer configuration (zod at the boundary). Lives in config/options/ so the perp agent
 * config tests do not pick it up. Testnet only and always simulated: the schema refuses anything
 * else, because there is no public options writer interface to trade against (docs/OPTIONS.md).
 */
import { readFileSync } from "node:fs";
import { z } from "zod";
import { sessionClassFor } from "@strata/risk";
import type { Market } from "@strata/sdk";
import type { OracleRef } from "../injective/oracle.js";
import { UNDERLYINGS } from "./book.js";
import type { OptionsRunnerParams, UnderlyingSpec } from "./runner.js";

const Positive = z.number().positive().finite();

export const OptionsConfig = z
  .object({
    name: z.string().min(1).max(64),
    network: z.literal("testnet"),
    agentId: z.number().int().positive(),
    /** EVM address of the strata-options keystore (public; .secrets/keystores/strata-options.json). */
    operator: z.string().regex(/^0x[0-9a-f]{40}$/),
    simulated: z.literal(true),
    notes: z.string().optional(),
    startingCashUsd: Positive,
    cycleMs: z.number().int().min(10_000).max(600_000),
    quoteEveryCycles: z.number().int().min(1).max(60),
    underlyings: z.array(z.object({ underlying: z.enum(UNDERLYINGS), ticker: z.string().min(1) })).min(1),
    strategy: z.object({
      targetAbsDelta: z.number().min(0.15).max(0.3),
      minAbsDelta: z.number().min(0.15).max(0.3),
      maxAbsDelta: z.number().min(0.15).max(0.3),
      volFloor: z.number().min(0.01).max(2),
      ivFloorMultiple: z.number().min(1).max(5),
      collateralPerWriteUsd: Positive,
      callCapMultiple: z.number().min(0.1).max(5),
      baseFillProbability: z.number().min(0).max(1),
      fillDecay: z.number().min(0).max(50),
    }),
    runner: z.object({
      maxOracleAgeSec: z.number().int().min(1).max(3_600),
      minTenorHours: z.number().min(1).max(14 * 24),
      maxOpenPerSeries: z.number().int().min(1).max(20),
      maxCollateralPerUnderlyingUsd: Positive,
      closeSpread: z.number().min(0).max(1),
      ewmaHalfLifeSec: z.number().min(60).max(30 * 86_400),
      minReturns: z.number().int().min(1).max(10_000),
    }),
    risk: z.object({
      maxDailyLossUsd: Positive,
      maxDrawdownUsd: Positive,
      maxGrossNotionalUsd: Positive,
      maxNetNotionalUsd: Positive,
      maxOrdersPerMinute: z.number().int().min(1).max(1_200),
    }),
  })
  .strict()
  .refine((c) => c.strategy.minAbsDelta <= c.strategy.targetAbsDelta && c.strategy.targetAbsDelta <= c.strategy.maxAbsDelta, "delta band must contain the target");
export type OptionsConfig = z.infer<typeof OptionsConfig>;

export function loadOptionsConfig(path: string): OptionsConfig {
  return OptionsConfig.parse(JSON.parse(readFileSync(path, "utf8")));
}

export function runnerParams(cfg: OptionsConfig): OptionsRunnerParams {
  const r = cfg.runner;
  return {
    strategy: cfg.strategy,
    maxOracleAgeSec: r.maxOracleAgeSec,
    minTenorMs: r.minTenorHours * 3_600_000,
    maxOpenPerSeries: r.maxOpenPerSeries,
    maxCollateralPerUnderlyingUsd: r.maxCollateralPerUnderlyingUsd,
    closeSpread: r.closeSpread,
    ewmaHalfLifeSec: r.ewmaHalfLifeSec,
    minReturns: r.minReturns,
  };
}

export interface ResolvedUnderlying {
  readonly spec: UnderlyingSpec;
  readonly oracle: OracleRef;
  readonly ticker: string;
}

/** Maps each underlying to its mainnet perp from the live-fetched market list (packages/config). */
export function resolveUnderlyings(cfg: OptionsConfig, mainnetMarkets: readonly Market[]): ResolvedUnderlying[] {
  return cfg.underlyings.map((u) => {
    const m = mainnetMarkets.find((x) => x.ticker === u.ticker);
    if (m === undefined) throw new Error(`underlying ${u.ticker} not found in markets.mainnet.json`);
    return {
      spec: { underlying: u.underlying, marketId: m.marketId, sessionClass: sessionClassFor(m.assetClass) },
      oracle: { oracleType: m.oracleType, oracleBase: m.oracleBase, oracleQuote: m.oracleQuote },
      ticker: m.ticker,
    };
  });
}
