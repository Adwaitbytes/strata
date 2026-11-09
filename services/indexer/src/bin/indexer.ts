/**
 * Live indexer entrypoint (PRD 11.1). Env: DATABASE_URL | DATABASE_URL_FILE, INDEXER_NETWORKS
 * (default "testnet"), INDEXER_EXTRA_MARKET_IDS, HOUSE_OPERATORS. Arena contract addresses come
 * from packages/contracts/deployments/<network>.json; without them the arena poller is off.
 */
import { createDb, describeDatabaseUrl, resolveDatabaseUrl } from "@strata/db";
import { createInjectiveReader } from "../injective/reader.js";
import { errMsg, log } from "../lib/log.js";
import { LiveIndexer } from "../live/indexer.js";
import { getMarkets } from "@strata/config";
import { NetworkName } from "@strata/sdk";
import { z } from "zod";
import { upsertMarketCatalog } from "../store/catalog.js";
import { configuredArenaIds, IndexerEnv, makePoller, startLivenessWatchdog } from "./common.js";

const env = IndexerEnv.parse(process.env);
const url = resolveDatabaseUrl();
const { db, sql, close } = createDb(url, { max: 6 });
log("info", "indexer starting", { db: describeDatabaseUrl(url), networks: env.INDEXER_NETWORKS });

const indexers = env.INDEXER_NETWORKS.map((network) => {
  const poller = makePoller(network, sql, env);
  if (!poller) log("warn", "no arena deployment found, arena poller disabled", { network });
  return new LiveIndexer({
    network,
    reader: createInjectiveReader(network),
    db,
    sql,
    configuredArenaIds: configuredArenaIds(network),
    extraMarketIds: env.INDEXER_EXTRA_MARKET_IDS,
    poller,
    catalog: getMarkets(network),
    liveness: startLivenessWatchdog("indexer", network),
  });
});

// The market catalog is static config, so it is also synced for networks this process does not
// index (mainnet read-only records for the Markets pages). Default: both networks.
const catalogNetworks = z
  .string()
  .default("mainnet,testnet")
  .transform((s) => s.split(",").map((x) => x.trim()).filter(Boolean))
  .pipe(z.array(NetworkName))
  .parse(process.env.INDEXER_CATALOG_NETWORKS);
const syncOtherCatalogs = async () => {
  for (const network of catalogNetworks.filter((n) => !env.INDEXER_NETWORKS.includes(n))) {
    try {
      log("info", "market catalog synced", { network, ...(await upsertMarketCatalog(db, getMarkets(network))) });
    } catch (e) {
      log("error", "market catalog sync failed", { network, error: errMsg(e) });
    }
  }
};
await syncOtherCatalogs();
setInterval(() => void syncOtherCatalogs(), 120_000);

for (const [i, idx] of indexers.entries()) {
  for (let attempt = 0; ; attempt++) {
    try {
      await idx.start();
      break;
    } catch (e) {
      const delay = Math.min(60_000, 2000 * 2 ** attempt);
      log("error", "indexer start failed, retrying", { network: env.INDEXER_NETWORKS[i], error: errMsg(e), delayMs: delay });
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

const shutdown = async (signal: string) => {
  log("info", "indexer stopping", { signal });
  await Promise.allSettled(indexers.map((i) => i.stop()));
  await close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("unhandledRejection", (e) => log("error", "unhandled rejection", { error: errMsg(e) }));
