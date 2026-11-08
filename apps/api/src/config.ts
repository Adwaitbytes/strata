/** Environment parsing. Every knob is validated once at boot so routes read typed values. */
import { z } from "zod";
import { EvmAddress } from "@strata/sdk";

const csv = z
  .string()
  .default("")
  .transform((s) => s.split(",").map((x) => x.trim()).filter((x) => x.length > 0));

const boolish = z
  .enum(["true", "false", "1", "0"])
  .default("false")
  .transform((v) => v === "true" || v === "1");

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  PORT: z.coerce.number().int().min(1).max(65_535).default(8787),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().url().optional(),
  /** Comma-separated exact origins allowed for browser CORS, e.g. https://strata-web.vercel.app */
  CORS_ORIGINS: csv,
  /** Owner EVM address whose signature authorizes admin calls. Admin is disabled when unset. */
  STRATA_OWNER_ADDRESS: EvmAddress.optional(),
  /** Behind Vercel or another proxy, trust X-Forwarded-For for the client IP used by rate limits. Defaults on when VERCEL is set. */
  TRUST_PROXY: z.enum(["true", "false", "1", "0"]).optional(),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  /** MOCK provenance rows are dropped from every response unless this is set outside production. */
  ALLOW_MOCK: boolish,
  WS_MAX_CONNECTIONS: z.coerce.number().int().positive().default(5_000),
  /** A book or quote older than this is not "now". */
  FRESH_MS: z.coerce.number().int().positive().default(60_000),
  ORACLE_MAX_AGE_SEC: z.coerce.number().int().positive().default(60),
  HEARTBEAT_MAX_AGE_MS: z.coerce.number().int().positive().default(90_000),
  /** Close streams after this long (0 = never). Defaults under the 300s Vercel Function limit when VERCEL is set. */
  STREAM_MAX_MS: z.coerce.number().int().nonnegative().optional(),
  VERCEL: z.string().optional(),
});

export interface ApiConfig {
  env: "development" | "test" | "production";
  logLevel: string;
  port: number;
  host: string;
  databaseUrl: string | null;
  corsOrigins: string[];
  ownerAddress: `0x${string}` | null;
  trustProxy: boolean;
  rateLimit: { max: number; windowMs: number };
  allowMock: boolean;
  wsMaxConnections: number;
  freshMs: number;
  oracleMaxAgeSec: number;
  heartbeatMaxAgeMs: number;
  streamMaxMs: number;
}

export function parseConfig(env: Record<string, string | undefined>): ApiConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid API environment: ${fields}`);
  }
  const e = parsed.data;
  if (e.NODE_ENV === "production" && e.ALLOW_MOCK) {
    throw new Error("ALLOW_MOCK cannot be set in production");
  }
  return {
    env: e.NODE_ENV,
    logLevel: e.LOG_LEVEL,
    port: e.PORT,
    host: e.HOST,
    databaseUrl: e.DATABASE_URL ?? null,
    corsOrigins: e.CORS_ORIGINS,
    ownerAddress: (e.STRATA_OWNER_ADDRESS as `0x${string}` | undefined) ?? null,
    trustProxy: e.TRUST_PROXY === undefined ? Boolean(e.VERCEL) : e.TRUST_PROXY === "true" || e.TRUST_PROXY === "1",
    rateLimit: { max: e.RATE_LIMIT_MAX, windowMs: e.RATE_LIMIT_WINDOW_MS },
    allowMock: e.ALLOW_MOCK,
    wsMaxConnections: e.WS_MAX_CONNECTIONS,
    freshMs: e.FRESH_MS,
    oracleMaxAgeSec: e.ORACLE_MAX_AGE_SEC,
    heartbeatMaxAgeMs: e.HEARTBEAT_MAX_AGE_MS,
    streamMaxMs: e.STREAM_MAX_MS ?? (e.VERCEL ? 280_000 : 0),
  };
}
