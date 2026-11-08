/**
 * One-shot backfill: arena contract events from the deploy block (or BACKFILL_RESET_CURSORS=1 to
 * replay from scratch) and Indexer trades for arena markets over the last BACKFILL_HOURS
 * (default 24). Every write is idempotent, so it is safe to run while the indexer is running.
 */
import { createDb, describeDatabaseUrl, resolveDatabaseUrl } from "@strata/db";
import { z } from "zod";
import { arenaMarketIds } from "../arena/project.js";
import { createInjectiveReader } from "../injective/reader.js";
import { log } from "../lib/log.js";
import { loadAgents } from "../live/agents.js";
import { backfillTrades } from "../live/backfill.js";
import { configuredArenaIds, IndexerEnv, makePoller } from "./common.js";

const env = IndexerEnv.extend({
  BACKFILL_HOURS: z.coerce.number().positive().default(24),
  BACKFILL_RESET_CURSORS: z.enum(["0", "1"]).default("0"),
}).parse(process.env);
const url = resolveDatabaseUrl();
const { db, sql, close } = createDb(url, { max: 2 });
log("info", "backfill starting", { db: describeDatabaseUrl(url), networks: env.INDEXER_NETWORKS, hours: env.BACKFILL_HOURS });

try {
  for (const network of env.INDEXER_NETWORKS) {
    const poller = makePoller(network, sql, env);
    if (poller) {
      if (env.BACKFILL_RESET_CURSORS === "1") await sql`DELETE FROM indexer_cursors WHERE network = ${network} AND source LIKE 'blockscout:%'`;
      log("info", "arena events backfilled", { network, ...(await poller.pollOnce()) });
    } else {
      log("warn", "no arena deployment found, skipping event backfill", { network });
    }
    const reader = createInjectiveReader(network);
    const ids = new Set([...(await arenaMarketIds(sql, network)), ...configuredArenaIds(network), ...env.INDEXER_EXTRA_MARKET_IDS].map((x) => x.toLowerCase()));
    const markets = (await reader.fetchMarkets()).filter((m) => ids.has(m.marketId.toLowerCase()));
    const agents = await loadAgents(sql, network);
    const now = Date.now();
    const r = await backfillTrades({
      network,
      reader,
      db,
      markets,
      agentBySubaccount: new Map(agents.map((a) => [a.subaccountId, a.agentId])),
      sinceMs: now - env.BACKFILL_HOURS * 3_600_000,
      untilMs: now,
    });
    log("info", "trades backfilled", { network, markets: markets.map((m) => m.ticker), ...r });
  }
} finally {
  await close();
}
