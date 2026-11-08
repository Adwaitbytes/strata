import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "./client.js";
import { loadMigrations, migrate } from "./migrate.js";

const urlFile = process.env.TEST_DATABASE_ADMIN_URL_FILE ?? fileURLToPath(new URL("../../../.secrets/local_db_url", import.meta.url));
const admin = process.env.TEST_DATABASE_ADMIN_URL ?? (existsSync(urlFile) ? readFileSync(urlFile, "utf8").trim() : null);
const dir = fileURLToPath(new URL("../migrations/", import.meta.url));

async function fresh(name: string): Promise<DbHandle> {
  const a = createDb(admin!, { max: 1 });
  await a.sql.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await a.sql.unsafe(`CREATE DATABASE ${name}`);
  await a.close();
  const u = new URL(admin!);
  u.pathname = `/${name}`;
  return createDb(u.toString(), { max: 1 });
}

describe("loadMigrations", () => {
  it("returns files in order with checksums", () => {
    const ms = loadMigrations(dir);
    expect(ms[0]?.name).toBe("0001_init.sql");
    expect(ms.map((m) => m.name)).toEqual([...ms.map((m) => m.name)].sort());
    expect(ms[0]?.checksum).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe.skipIf(!admin)("migrate (local TimescaleDB)", () => {
  let h: DbHandle | null = null;
  afterEach(async () => {
    await h?.close();
    h = null;
  });

  it("applies everything once, then skips; rejects edited history", async () => {
    h = await fresh("strata_w4_migrate_test");
    const ms = loadMigrations(dir);
    const first = await migrate(h.sql, ms);
    expect(first.applied).toEqual(ms.map((m) => m.name));
    const second = await migrate(h.sql, ms);
    expect(second.applied).toEqual([]);
    expect(second.skipped).toHaveLength(ms.length);
    const edited = ms.map((m, i) => (i === 0 ? { ...m, checksum: "0".repeat(64) } : m));
    await expect(migrate(h.sql, edited)).rejects.toThrow(/checksum mismatch/);
  }, 60_000);

  it("adopts a 0001 that was applied outside the runner (docker initdb, manual Neon)", async () => {
    h = await fresh("strata_w4_adopt_test");
    const ms = loadMigrations(dir);
    await h.sql.unsafe(ms[0]!.sql);
    const r = await migrate(h.sql, ms);
    expect(r.adopted).toEqual(["0001_init.sql"]);
    expect(r.applied).toEqual(ms.slice(1).map((m) => m.name));
  }, 60_000);
});
