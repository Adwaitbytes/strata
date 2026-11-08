/** Resume points in indexer_cursors (migration 0002). */
import type { Sql } from "@strata/db";
import type { NetworkName } from "@strata/sdk";

export async function readCursor<T>(sql: Sql, network: NetworkName, source: string): Promise<T | null> {
  const [row] = await sql<{ cursor: T }[]>`SELECT cursor FROM indexer_cursors WHERE network = ${network} AND source = ${source}`;
  return row?.cursor ?? null;
}

export async function writeCursor(sql: Sql, network: NetworkName, source: string, cursor: Record<string, string | number | null>): Promise<void> {
  await sql`
    INSERT INTO indexer_cursors (network, source, cursor, updated_at) VALUES (${network}, ${source}, ${sql.json(cursor)}, now())
    ON CONFLICT (network, source) DO UPDATE SET cursor = excluded.cursor, updated_at = excluded.updated_at`;
}
