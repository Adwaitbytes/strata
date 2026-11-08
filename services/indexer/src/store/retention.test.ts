import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "@strata/db";
import { freshTestDb, hasTestDb } from "../../test/db.js";
import { downsampleBaseline } from "./retention.js";

describe.skipIf(!hasTestDb)("downsampleBaseline (local TimescaleDB)", () => {
  let h: DbHandle;
  beforeAll(async () => {
    h = await freshTestDb("strata_w4_retention_test");
  }, 60_000);
  afterAll(async () => h?.close());

  it("keeps minute-boundary BASELINE rows and every non-BASELINE row", async () => {
    const base = Date.UTC(2026, 10, 1, 0, 0, 0);
    for (let i = 0; i < 24; i++) {
      const at = new Date(base + i * 5_000);
      for (const provenance of ["BASELINE", "TESTNET"]) {
        await h.sql`INSERT INTO book_snapshots (network, market_id, at, provenance, depth_usd_25, strata_depth_usd_25, bids, asks, session_state)
          VALUES ('testnet', ${provenance === "BASELINE" ? "0xa" : "0xb"}, ${at}, ${provenance}, 0, 0, '[]'::jsonb, '[]'::jsonb, 'unknown')`;
      }
    }
    const removed = await downsampleBaseline(h.sql, "testnet", 1, new Date(base + 10 * 3_600_000));
    expect(removed).toBe(22);
    const rows = await h.sql<{ provenance: string; n: number }[]>`SELECT provenance::text, count(*)::int AS n FROM book_snapshots GROUP BY 1 ORDER BY 1`;
    expect(rows).toEqual([{ provenance: "BASELINE", n: 2 }, { provenance: "TESTNET", n: 24 }]);
    expect(await downsampleBaseline(h.sql, "testnet", 1, new Date(base + 10 * 3_600_000))).toBe(0);
  });
});
