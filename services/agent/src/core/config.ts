/**
 * Agent configuration (zod at the boundary). Configs live in services/agent/config/agents/*.json,
 * are version-controlled and printed on the Transparency page (PRD 9.6). Markets are referenced by
 * ticker and resolved at runtime against @strata/config's generated market list, which comes from a
 * live Indexer query; market IDs are never hand-typed.
 */
import { readFileSync } from "node:fs";
import { z } from "zod";
import type { Market } from "@strata/sdk";
import { DEFAULT_PARAMS, RiskParams, assertMainnetCaps, sessionClassFor, type SessionClass } from "@strata/risk";
import type { MarketRuntime } from "./loop.js";
import { ShadowReview } from "./tuner.js";

// Same schema as @strata/risk RiskParams; unknown names are rejected, values are clamped later.
const ParamOverrides = RiskParams.partial().strict();
type ParamOverrides = Partial<RiskParams>;

const SessionClassSchema = z.enum(["us_equity", "fx", "cme_globex", "always_open"]);

export const MarketConfig = z
  .object({
    ticker: z.string().min(1),
    /** Overrides the calendar derived from the market's asset class. */
    sessionClass: SessionClassSchema.optional(),
    params: ParamOverrides.optional(),
  })
  .strict();
export type MarketConfig = z.infer<typeof MarketConfig>;

export const AgentConfig = z
  .object({
    name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/),
    network: z.enum(["mainnet", "testnet"]),
    /** Mainnet configs stay committed but disabled until the owner funds a wallet (D27, D33). */
    enabled: z.boolean(),
    /** Capital the agent may use, USD. Mainnet is capped by MAINNET_CAPITAL_CAP_USD (D6). */
    capitalUsd: z.number().positive(),
    notes: z.string().optional(),
    params: ParamOverrides.default({}),
    markets: z.array(MarketConfig).min(1),
    tuner: z
      .object({
        mode: z.enum(["off", "shadow", "live"]).default("shadow"),
        intervalMin: z.number().min(5).max(15).default(10),
        shadowReview: ShadowReview.nullable().default(null),
      })
      .strict()
      .default({}),
    loop: z
      .object({
        settleMs: z.number().int().min(1_000).max(120_000).default(30_000),
        callTimeoutMs: z.number().int().min(1_000).max(60_000).default(8_000),
      })
      .strict()
      .default({}),
  })
  .strict();
export type AgentConfig = z.infer<typeof AgentConfig>;

export function loadAgentConfig(path: string): AgentConfig {
  return AgentConfig.parse(JSON.parse(readFileSync(path, "utf8")));
}

/** Defaults, then agent-wide overrides, then per-market overrides. Mainnet caps are enforced here. */
export function buildRiskParams(cfg: AgentConfig, market: MarketConfig): RiskParams {
  const params: RiskParams = { ...DEFAULT_PARAMS, ...(cfg.params as ParamOverrides), ...((market.params ?? {}) as ParamOverrides) };
  assertMainnetCaps({ network: cfg.network, capitalUsd: cfg.capitalUsd, params });
  return params;
}

export interface ResolvedMarket {
  readonly config: MarketConfig;
  readonly market: Market;
  readonly runtime: MarketRuntime;
}

export function resolveMarkets(cfg: AgentConfig, available: readonly Market[]): ResolvedMarket[] {
  const missing: string[] = [];
  const out: ResolvedMarket[] = [];
  for (const mc of cfg.markets) {
    const market = available.find((m) => m.ticker === mc.ticker);
    if (market === undefined) {
      missing.push(mc.ticker);
      continue;
    }
    if (market.network !== cfg.network) throw new Error(`market ${mc.ticker} is on network ${market.network}, agent ${cfg.name} is on ${cfg.network}`);
    const sessionClass: SessionClass = mc.sessionClass ?? sessionClassFor(market.assetClass);
    out.push({
      config: mc,
      market,
      runtime: {
        marketId: market.marketId,
        ticker: market.ticker,
        sessionClass,
        spec: { tickSize: market.minPriceTickSize, minQuantity: market.minQuantityTickSize, minNotional: market.minNotional },
      },
    });
  }
  if (missing.length > 0) {
    throw new Error(`agent ${cfg.name}: tickers not found in the generated ${cfg.network} market list (run pnpm fetch-markets): ${missing.join(", ")}`);
  }
  return out;
}

const bool = z
  .string()
  .optional()
  .transform((v) => v !== undefined && ["true", "1", "yes"].includes(v.trim().toLowerCase()));

export const AgentEnv = z.object({
  STRATA_NETWORK: z.enum(["mainnet", "testnet"]),
  /** Config name (resolved in config/agents) or a path to a JSON file. */
  AGENT_CONFIG: z.string().min(1),
  /** Arena agent ID from StrataArena enrollment. */
  AGENT_ID: z.coerce.number().int().positive().optional(),
  STRATA_ADAPTER: z.enum(["injective", "sim"]).default("injective"),
  METRICS_PORT: z.coerce.number().int().min(1).max(65_535).default(9464),
  METRICS_HOST: z.string().default("0.0.0.0"),
  ANTHROPIC_MODEL: z.string().min(1).default("claude-opus-5-5"),
  ADMIN_OWNER_ADDRESS: z.string().optional(),
  INTERNAL_KILL_TOKEN_FILE: z.string().default("/run/secrets/internal_kill_token"),
  KILL_SWITCH: z.string().optional(),
  KILL_SWITCH_CLOSE: z.string().optional(),
  SECRETS_DIR: z.string().default(".secrets"),
  /** Keystore folder (keystores/<name>.json + <name>.pass); compose mounts it apart from SECRETS_DIR. Defaults to SECRETS_DIR. */
  STRATA_SECRETS_DIR: z.string().min(1).optional(),
  /**
   * Write quotes, cancels and fills to agent_orders / agent_fills. Default: only for the simulator;
   * with the Injective adapter the indexer owns both tables (it records every order and fill from
   * the chain and the Indexer trade stream).
   */
  AGENT_RECORD_ORDERS: z.enum(["true", "false"]).optional(),
  /** Explicit orchestrator go-ahead for mainnet; mainnet configs also need enabled: true. */
  MAINNET_GO_AHEAD: bool,
});
export type AgentEnv = z.infer<typeof AgentEnv>;
