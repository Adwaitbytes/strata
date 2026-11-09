/** Shared wiring for the indexer and backfill entrypoints. */
import { fileURLToPath } from "node:url";
import { getMarkets, NETWORKS } from "@strata/config";
import { LivenessWatchdog, watchdogConfigFromEnv, type Sql } from "@strata/db";
import { NetworkName } from "@strata/sdk";
import { z } from "zod";
import { BlockscoutClient } from "../arena/blockscout.js";
import { resolveArenaContracts } from "../arena/contracts.js";
import { ArenaPoller } from "../arena/poller.js";
import { log } from "../lib/log.js";

export const DEPLOYMENTS_DIR = fileURLToPath(new URL("../../../../packages/contracts/deployments", import.meta.url));

const Hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
const Hex20 = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const csv = <T extends z.ZodTypeAny>(item: T) =>
  z
    .string()
    .default("")
    .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean))
    .pipe(z.array(item));

export const IndexerEnv = z.object({
  /** Testnet first (CLAUDE.md). Mainnet is read-only here, but opt in explicitly. */
  INDEXER_NETWORKS: csv(NetworkName).default("testnet"),
  /** Extra market IDs to index; they must also appear in the live Indexer market list. */
  INDEXER_EXTRA_MARKET_IDS: csv(Hex32),
  /** Operators (EVM, lowercase) whose agents are house agents. */
  HOUSE_OPERATORS: csv(Hex20),
});
export type IndexerEnv = z.infer<typeof IndexerEnv>;

export function configuredArenaIds(network: NetworkName): string[] {
  return getMarkets(network).filter((m) => m.arenaEnabled).map((m) => m.marketId);
}

export function makePoller(network: NetworkName, sql: Sql, env: IndexerEnv): ArenaPoller | null {
  const contracts = resolveArenaContracts(network, DEPLOYMENTS_DIR);
  if (!contracts.arena && !contracts.attestor) return null;
  return new ArenaPoller(network, sql, BlockscoutClient.forExplorer(NETWORKS[network].evm.explorer), contracts, {
    houseOperators: new Set(env.HOUSE_OPERATORS.map((a) => a.toLowerCase())),
  });
}

/**
 * One watchdog per network loop. On a trip the process exits 1 and run-service.sh starts it again
 * with fresh pools and RPC clients (soak finding 2026-11-09: stuck pools never recovered in place).
 */
export function startLivenessWatchdog(service: string, network: NetworkName, env: NodeJS.ProcessEnv = process.env): LivenessWatchdog {
  const cfg = watchdogConfigFromEnv(env, { stallMs: 180_000 });
  const w = new LivenessWatchdog({
    ...cfg,
    onTrip: (trip) => {
      log("error", "liveness watchdog tripped, exiting for a supervised restart", { service, network, ...trip, ...cfg });
      process.exit(1);
    },
  });
  w.start(Math.min(10_000, cfg.stallMs));
  return w;
}
