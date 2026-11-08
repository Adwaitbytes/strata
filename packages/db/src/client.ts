/**
 * Database connection. DATABASE_URL is the single switch between local TimescaleDB (D5) and
 * production Neon (D26). DATABASE_URL_FILE points at a file holding the URL (for example
 * `.secrets/neon_url`) so the connection string never has to be pasted into a shell or a log.
 */
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";

export type Sql = postgres.Sql;
export type Db = PostgresJsDatabase<typeof schema>;

export interface DbHandle {
  sql: Sql;
  db: Db;
  close: () => Promise<void>;
}

export function resolveDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const direct = env.DATABASE_URL?.trim();
  if (direct) return direct;
  const file = env.DATABASE_URL_FILE?.trim();
  if (file) {
    const fromFile = readFileSync(file, "utf8").trim();
    if (!fromFile) throw new Error(`DATABASE_URL_FILE ${file} is empty`);
    return fromFile;
  }
  throw new Error("Set DATABASE_URL or DATABASE_URL_FILE");
}

/** Host part only, for logs. Never log the full URL: it carries the password. */
export function describeDatabaseUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || "5432"}${u.pathname}`;
  } catch {
    return "<unparseable DATABASE_URL>";
  }
}

export function createDb(url: string = resolveDatabaseUrl(), options: { max?: number } = {}): DbHandle {
  const needsTls = !/@(localhost|127\.0\.0\.1|db)(:|\/)/.test(url) && !/sslmode=disable/.test(url);
  // Neon's pooled endpoint is PgBouncer in transaction mode, which cannot keep prepared statements.
  const pooled = /-pooler\./.test(url);
  const open = (max: number) =>
    postgres(url, {
      max,
      prepare: !pooled,
      ssl: needsTls ? "require" : false,
      onnotice: () => {},
      connection: { application_name: "strata" },
    });
  // drizzle-orm's postgres-js driver replaces the client's date/json serializers with pass-through
  // ones, which breaks Date and sql.json() parameters in raw queries. Raw SQL gets its own client.
  const sql = open(options.max ?? 5);
  const drizzleClient = open(Math.max(1, Math.ceil((options.max ?? 5) / 2)));
  return {
    sql,
    db: drizzle(drizzleClient, { schema }),
    close: async () => {
      await Promise.all([sql.end({ timeout: 5 }), drizzleClient.end({ timeout: 5 })]);
    },
  };
}
