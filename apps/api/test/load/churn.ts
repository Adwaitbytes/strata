/**
 * Load-test data churn: writes a MOCK book snapshot every 50 ms and a MOCK guard event every
 * 500 ms so ws-load.ts sees channels that change faster than the 4/s push cap.
 * Refuses to run unless TEST_DATABASE_URL names a database ending in `_test`.
 * Run the API with ALLOW_MOCK=true (never in production) while using this.
 *
 *   TEST_DATABASE_URL=... pnpm tsx test/load/churn.ts --seconds 30 --market 0x<64 hex>
 */
import { parseArgs } from "node:util";
import postgres from "postgres";
import { Hex32 } from "@strata/sdk";

const { values } = parseArgs({ options: { seconds: { type: "string", default: "30" }, market: { type: "string", default: `0x${"a".repeat(64)}` } } });
const url = process.env["TEST_DATABASE_URL"];
if (!url || !new URL(url).pathname.endsWith("_test")) {
  console.error("TEST_DATABASE_URL must point at a database whose name ends in _test");
  process.exit(1);
}
const market = Hex32.parse(values.market);
const sql = postgres(url, { max: 1, onnotice: () => {} });
const end = Date.now() + Number(values.seconds) * 1_000;
let i = 0;
while (Date.now() < end) {
  const at = new Date();
  await sql`insert into book_snapshots (network, market_id, at, provenance, mid, spread_bps, depth_usd_25, strata_depth_usd_25, bids, asks, session_state)
    values ('testnet', ${market}, ${at}, 'MOCK', '100', ${10 + (i % 7)}, 2000, 800,
      ${sql.json([{ price: "99.9", quantity: String(1 + i), strataQuantity: "1" }])}, ${sql.json([])}, 'open')`;
  if (i % 10 === 0) {
    await sql`insert into guard_events (id, network, provenance, agent_id, market_id, guard, action, reason, detail, observed, at)
      values (${`load-${Date.now()}-${i}`}, 'testnet', 'MOCK', 1, ${market}, 'oracle', 'widen', 'oracle_stale', 'load test churn', ${sql.json({ i })}, ${at})`;
  }
  i += 1;
  await new Promise((r) => setTimeout(r, 50));
}
console.log(`churn wrote ${i} snapshots`);
await sql.end();
