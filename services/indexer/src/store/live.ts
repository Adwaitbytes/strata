/** Idempotent writes for live Indexer data. Natural keys make every replay a no-op. */
import { agentFills, agentOrders, agentPositions, oraclePrices, trades, type Db } from "@strata/db";
import { sql } from "drizzle-orm";
import type { FillRow, OrderRow, PositionRow, TradeRow } from "../live/mappers.js";

export type OracleRow = typeof oraclePrices.$inferInsert;

export async function insertTrades(db: Db, rows: readonly TradeRow[], fills: readonly FillRow[]): Promise<{ trades: number; fills: number }> {
  let t = 0;
  let f = 0;
  if (rows.length > 0) t = (await db.insert(trades).values([...rows]).onConflictDoNothing().returning({ id: trades.tradeId })).length;
  if (fills.length > 0) f = (await db.insert(agentFills).values([...fills]).onConflictDoNothing().returning({ id: agentFills.tradeId })).length;
  return { trades: t, fills: f };
}

/** Orders are upserted: a later cancel sets cancelled_at on the row created when it was posted. */
export async function upsertAgentOrders(db: Db, rows: readonly OrderRow[]): Promise<void> {
  if (rows.length === 0) return;
  await db
    .insert(agentOrders)
    .values([...rows])
    .onConflictDoUpdate({
      target: [agentOrders.network, agentOrders.orderHash, agentOrders.postedAt],
      set: { cancelledAt: sql`coalesce(${agentOrders.cancelledAt}, excluded.cancelled_at)` },
    });
}

export async function insertPositions(db: Db, rows: readonly PositionRow[]): Promise<void> {
  if (rows.length === 0) return;
  await db.insert(agentPositions).values([...rows]).onConflictDoNothing();
}

export async function insertOraclePrices(db: Db, rows: readonly OracleRow[]): Promise<void> {
  if (rows.length === 0) return;
  await db.insert(oraclePrices).values([...rows]).onConflictDoNothing();
}
