/**
 * Storage budget for the Neon free tier (0.5 GB, D26). BASELINE samples older than `afterHours`
 * are thinned from 5 s to 1 minute resolution (rows on the minute boundary are kept, and those are
 * the rows that carry full stored depth). Time-weighted baseline spread and depth stay meaningful;
 * only LIVE/TESTNET agent-era rows used for scoring are never touched.
 */
import type { Sql } from "@strata/db";
import type { NetworkName } from "@strata/sdk";

export async function downsampleBaseline(sql: Sql, network: NetworkName, afterHours: number, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - afterHours * 3_600_000);
  const res = await sql`
    DELETE FROM book_snapshots
    WHERE network = ${network} AND provenance = 'BASELINE' AND at < ${cutoff}
      AND extract(second FROM at) <> 0`;
  return res.count;
}
