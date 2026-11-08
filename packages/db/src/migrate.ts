/**
 * Ordered SQL migration runner. Applies `migrations/*.sql` in lexical order, each in its own
 * transaction, and records name + sha256 in `strata_migrations`. A migration whose file changed
 * after it was applied is a hard error (edit by adding a new file, never by rewriting history).
 *
 * Adoption: the local Docker DB runs 0001 through docker-entrypoint-initdb.d before this runner
 * exists in the database. If the ledger is empty but 0001's tables are present, 0001 is recorded
 * as applied instead of being re-run.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Sql } from "./client.js";

export interface MigrationFile {
  name: string;
  sql: string;
  checksum: string;
}

export interface MigrationResult {
  applied: string[];
  adopted: string[];
  skipped: string[];
}

export function loadMigrations(dir: string): MigrationFile[] {
  return readdirSync(dir)
    .filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f))
    .sort()
    .map((name) => {
      const sql = readFileSync(join(dir, name), "utf8");
      return { name, sql, checksum: createHash("sha256").update(sql).digest("hex") };
    });
}

const LEDGER_DDL = `CREATE TABLE IF NOT EXISTS strata_migrations (
  name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now(), adopted boolean NOT NULL DEFAULT false)`;

export async function migrate(sql: Sql, migrations: MigrationFile[]): Promise<MigrationResult> {
  await sql.unsafe(LEDGER_DDL);
  // One runner at a time across processes.
  await sql`SELECT pg_advisory_lock(hashtext('strata_migrations'))`;
  try {
    const rows = await sql<{ name: string; checksum: string }[]>`SELECT name, checksum FROM strata_migrations`;
    const done = new Map(rows.map((r) => [r.name, r.checksum]));
    const result: MigrationResult = { applied: [], adopted: [], skipped: [] };

    for (const m of migrations) {
      const prior = done.get(m.name);
      if (prior !== undefined) {
        if (prior !== m.checksum) throw new Error(`migration ${m.name} changed after it was applied (checksum mismatch)`);
        result.skipped.push(m.name);
        continue;
      }
      if (done.size === 0 && m.name.startsWith("0001_") && (await initSchemaPresent(sql))) {
        await sql`INSERT INTO strata_migrations (name, checksum, adopted) VALUES (${m.name}, ${m.checksum}, true)`;
        done.set(m.name, m.checksum);
        result.adopted.push(m.name);
        continue;
      }
      await sql.begin(async (tx) => {
        await tx.unsafe(m.sql);
        await tx`INSERT INTO strata_migrations (name, checksum) VALUES (${m.name}, ${m.checksum})`;
      });
      done.set(m.name, m.checksum);
      result.applied.push(m.name);
    }
    return result;
  } finally {
    await sql`SELECT pg_advisory_unlock(hashtext('strata_migrations'))`;
  }
}

async function initSchemaPresent(sql: Sql): Promise<boolean> {
  const [row] = await sql<{ present: boolean }[]>`SELECT to_regclass('public.book_snapshots') IS NOT NULL AS present`;
  return row?.present ?? false;
}
