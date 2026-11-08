/** `pnpm --filter @strata/db migrate`: apply packages/db/migrations/*.sql to DATABASE_URL. */
import { fileURLToPath } from "node:url";
import { createDb, describeDatabaseUrl, resolveDatabaseUrl } from "../client.js";
import { loadMigrations, migrate } from "../migrate.js";

const url = resolveDatabaseUrl();
const dir = fileURLToPath(new URL("../../migrations/", import.meta.url));
const { sql, close } = createDb(url, { max: 1 });
try {
  const result = await migrate(sql, loadMigrations(dir));
  console.log(JSON.stringify({ target: describeDatabaseUrl(url), ...result }));
} catch (err) {
  console.error(`migrate failed on ${describeDatabaseUrl(url)}:`, err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await close();
}
