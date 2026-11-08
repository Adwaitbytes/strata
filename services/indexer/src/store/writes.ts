/** Idempotent writes shared by the baseline recorder and the indexer. */
import { bookSnapshots, heartbeats, markets, type Db } from "@strata/db";
import type { NetworkName } from "@strata/sdk";
import { sql } from "drizzle-orm";
import type { CandidateMarket } from "../markets/select.js";

export type BookSnapshotRow = typeof bookSnapshots.$inferInsert;

/**
 * `catalog` holds full sdk Market records from @strata/config by lowercase market ID; when one
 * exists it is written as markets.data (with the Indexer fields alongside), otherwise the
 * Indexer-derived partial record is.
 */
export async function upsertMarkets(
  db: Db,
  list: readonly CandidateMarket[],
  source: string,
  fetchedAt: Date,
  catalog: ReadonlyMap<string, Record<string, unknown>> = new Map(),
): Promise<void> {
  if (list.length === 0) return;
  const rows = list.map((m) => ({
    network: m.network,
    marketId: m.marketId,
    ticker: m.ticker,
    data: {
      assetClass: m.assetClass,
      quoteDecimals: m.quoteDecimals,
      oracleType: m.oracleType,
      oracleBase: m.oracleBase,
      oracleQuote: m.oracleQuote,
      oracleScaleFactor: m.oracleScaleFactor,
      source,
      indexer: m.raw.raw,
      ...(catalog.get(m.marketId.toLowerCase()) ?? {}),
    },
    fetchedAt,
  }));
  // arena_enabled is owned by the arena registry, so a refresh never flips it.
  await db
    .insert(markets)
    .values(rows)
    .onConflictDoUpdate({
      target: [markets.network, markets.marketId],
      set: { ticker: sql`excluded.ticker`, data: sql`excluded.data`, fetchedAt: sql`excluded.fetched_at` },
    });
}

export async function insertBookSnapshots(db: Db, rows: readonly BookSnapshotRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const inserted = await db.insert(bookSnapshots).values([...rows]).onConflictDoNothing().returning({ m: bookSnapshots.marketId });
  return inserted.length;
}

export async function upsertHeartbeat(db: Db, network: NetworkName, service: string, at: Date, detail: Record<string, unknown>): Promise<void> {
  await db
    .insert(heartbeats)
    .values({ network, service, at, detail })
    .onConflictDoUpdate({ target: [heartbeats.network, heartbeats.service], set: { at, detail } });
}
