/**
 * Integration-test database: a throwaway `strata_w4_test` database on the local TimescaleDB
 * (TEST_DATABASE_ADMIN_URL, or the URL file at TEST_DATABASE_ADMIN_URL_FILE, default
 * ../../.secrets/local_db_url). Tests that need it are skipped when neither is available.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createDb, loadMigrations, migrate, type DbHandle } from "@strata/db";

const DEFAULT_FILE = fileURLToPath(new URL("../../../.secrets/local_db_url", import.meta.url));
const MIGRATIONS = fileURLToPath(new URL("../../../packages/db/migrations/", import.meta.url));

export function adminUrl(): string | null {
  if (process.env.TEST_DATABASE_ADMIN_URL) return process.env.TEST_DATABASE_ADMIN_URL;
  const file = process.env.TEST_DATABASE_ADMIN_URL_FILE ?? DEFAULT_FILE;
  return existsSync(file) ? readFileSync(file, "utf8").trim() : null;
}

export const hasTestDb = adminUrl() !== null;

export async function freshTestDb(name = "strata_w4_test"): Promise<DbHandle> {
  const admin = adminUrl();
  if (!admin) throw new Error("no test database configured");
  const a = createDb(admin, { max: 1 });
  await a.sql.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await a.sql.unsafe(`CREATE DATABASE ${name}`);
  await a.close();
  const u = new URL(admin);
  u.pathname = `/${name}`;
  const h = createDb(u.toString(), { max: 2 });
  await migrate(h.sql, loadMigrations(MIGRATIONS));
  return h;
}
