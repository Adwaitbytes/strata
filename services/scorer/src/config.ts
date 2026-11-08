/**
 * Scorer process configuration from the environment, validated with zod.
 * Contract addresses default to packages/config (filled after deploy) and can be overridden.
 * The database URL is resolved separately by @strata/db (DATABASE_URL or DATABASE_URL_FILE).
 */
import { z } from "zod";
import { getNetwork, type NetworkConfig } from "@strata/config";
import { EvmAddress, NetworkName } from "@strata/sdk";
import type { Address } from "viem";
import { BOOK_STALENESS_MS, MARKOUT_HORIZON_MS } from "./metrics.js";

const bool = z.enum(["true", "false"]).transform((v) => v === "true");
const seconds = z.coerce.number().int().positive();

const ApiBase = z
  .string()
  .url()
  .refine((u) => {
    const url = new URL(u);
    return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname));
  }, "SCORER_API_BASE must be https (http only for localhost)");

const Env = z.object({
  STRATA_NETWORK: NetworkName,
  SCORER_API_BASE: ApiBase,
  STRATA_ARENA_ADDRESS: EvmAddress.optional(),
  STRATA_SCORE_ATTESTOR_ADDRESS: EvmAddress.optional(),
  SCORER_SETTLE_DELAY_SEC: seconds.default(120),
  SCORER_POLL_SEC: seconds.default(30),
  SCORER_METRICS_PORT: z.coerce.number().int().min(1).max(65_535).default(9464),
  SCORER_DRY_RUN: bool.default("false"),
  SCORER_ATTESTOR_KEY: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/).optional(),
  SCORER_ALLOW_MAINNET_POSTING: bool.default("false"),
  SCORER_EPOCH_SECONDS: seconds.default(3_600),
  /** Overrides the network's public RPC, e.g. a private endpoint or a local anvil fork. */
  SCORER_RPC_URL: z.string().url().optional(),
});

export interface ScorerConfig {
  network: NetworkName;
  networkConfig: NetworkConfig;
  rpcUrl: string;
  apiBase: string;
  arena: Address;
  attestor: Address;
  settleDelayMs: number;
  pollMs: number;
  metricsPort: number;
  dryRun: boolean;
  once: boolean;
  attestorKeyName: string;
  allowMainnet: boolean;
  /** Expected season epoch length; the onchain season value wins, a mismatch is logged. */
  expectedEpochSeconds: number;
}

export function loadScorerConfig(env: Record<string, string | undefined>, argv: readonly string[]): ScorerConfig {
  const parsed = Env.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`invalid scorer environment: ${issues}`);
  }
  const e = parsed.data;
  const settleDelayMs = e.SCORER_SETTLE_DELAY_SEC * 1_000;
  if (settleDelayMs < MARKOUT_HORIZON_MS + BOOK_STALENESS_MS) {
    throw new Error(`SCORER_SETTLE_DELAY_SEC must be at least ${(MARKOUT_HORIZON_MS + BOOK_STALENESS_MS) / 1_000} so 60 s markouts have book data`);
  }
  const networkConfig = getNetwork(e.STRATA_NETWORK);
  const arena = e.STRATA_ARENA_ADDRESS ?? networkConfig.contracts.arena;
  const attestor = e.STRATA_SCORE_ATTESTOR_ADDRESS ?? networkConfig.contracts.attestor;
  if (!arena) throw new Error(`no StrataArena address for ${e.STRATA_NETWORK}: set STRATA_ARENA_ADDRESS or packages/config contracts.arena`);
  if (!attestor) throw new Error(`no ScoreAttestor address for ${e.STRATA_NETWORK}: set STRATA_SCORE_ATTESTOR_ADDRESS or packages/config contracts.attestor`);
  return {
    network: e.STRATA_NETWORK,
    networkConfig,
    rpcUrl: e.SCORER_RPC_URL ?? rpcFromConfig(networkConfig),
    apiBase: e.SCORER_API_BASE,
    arena: arena as Address,
    attestor: attestor as Address,
    settleDelayMs,
    pollMs: e.SCORER_POLL_SEC * 1_000,
    metricsPort: e.SCORER_METRICS_PORT,
    dryRun: e.SCORER_DRY_RUN || argv.includes("--dry-run"),
    once: argv.includes("--once"),
    attestorKeyName: e.SCORER_ATTESTOR_KEY ?? `strata-${e.STRATA_NETWORK}-attestor`,
    allowMainnet: e.SCORER_ALLOW_MAINNET_POSTING,
    expectedEpochSeconds: e.SCORER_EPOCH_SECONDS,
  };
}

function rpcFromConfig(n: NetworkConfig): string {
  const url = n.evm.rpcUrls[0];
  if (!url) throw new Error(`no RPC URL configured for ${n.name}: set SCORER_RPC_URL`);
  return url;
}
