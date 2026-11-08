/**
 * Entrypoint for both hosts:
 * - Vercel detects Fastify at src/index.ts (https://vercel.com/docs/frameworks/backend/fastify)
 *   and turns this server into one Function on Fluid compute.
 * - Standalone: `node dist/index.js` listens on HOST:PORT.
 */
// Vercel's Fastify detection requires the entrypoint itself to import "fastify".
import type { FastifyInstance } from "fastify";
import { buildApp } from "./create-app.js";
import { parseConfig } from "./config.js";
import { connect, DrizzleRepository, type DbConnection } from "./repo/drizzle.js";
import type { Repository } from "./repo/types.js";
import { unavailableRepository } from "./repo/unavailable.js";

const config = parseConfig(process.env);

let conn: DbConnection | null = null;
let reportInvalidRow: (table: string, issues: string) => void = () => {};
let repo: Repository;
if (config.databaseUrl) {
  conn = connect(config.databaseUrl);
  repo = new DrizzleRepository(conn.db, { onInvalidRow: (table, issues) => reportInvalidRow(table, issues) });
} else {
  repo = unavailableRepository();
}

const app: FastifyInstance = await buildApp({ config, repo });
reportInvalidRow = (table, issues) => app.log.warn({ table, issues }, "dropped row that failed its schema");
if (!conn) app.log.warn("DATABASE_URL is not set: data routes will answer 503");
if (!config.ownerAddress) app.log.warn("STRATA_OWNER_ADDRESS is not set: admin routes are disabled");

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  try {
    await app.close();
    await conn?.close();
  } catch (err) {
    app.log.error({ err }, "error during shutdown");
  } finally {
    process.exit(0);
  }
};
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ port: config.port, host: config.host });
