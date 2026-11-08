/** Prints baseline row counts per network from DATABASE_URL (no secrets in output). */
import { createDb, describeDatabaseUrl, resolveDatabaseUrl } from "@strata/db";

const url = resolveDatabaseUrl();
const { sql, close } = createDb(url, { max: 1 });
try {
  const rows = await sql`
    SELECT network, provenance, count(*)::int AS rows, count(DISTINCT market_id)::int AS markets,
           count(mid)::int AS two_sided, min(at) AS first_at, max(at) AS last_at
    FROM book_snapshots GROUP BY 1, 2 ORDER BY 1, 2`;
  const hb = await sql`SELECT network, service, at, detail->>'errors' AS errors, detail->>'lastLatencyMs' AS latency_ms FROM heartbeats ORDER BY 1, 2`;
  const size = await sql`SELECT pg_size_pretty(pg_database_size(current_database())) AS db_size`;
  console.log(JSON.stringify({ db: describeDatabaseUrl(url), snapshots: rows, heartbeats: hb, ...size[0] }, null, 1));
} finally {
  await close();
}
