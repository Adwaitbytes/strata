/**
 * Fastify app factory. Pure wiring: no env reads, no listen, so tests, the standalone
 * server and the Vercel entrypoint all build the same instance.
 */
import Fastify, { type FastifyInstance } from "fastify";
import type { ZodTypeAny } from "zod";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import type { ApiConfig } from "./config.js";
import { HttpError, parseInput, registerErrorHandlers, validated } from "./errors.js";
import type { Repository } from "./repo/types.js";
import type { ReadContext } from "./services/read.js";
import { PUBLIC_ROUTES } from "./routes/table.js";
import { sweepingStoreClass } from "./rate-limit-store.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerDocs } from "./openapi.js";
import { registerMcp } from "./mcp/server.js";
import { registerStream } from "./stream/routes.js";
import type { HubOptions } from "./stream/hub.js";

export interface AppDeps {
  config: ApiConfig;
  repo: Repository;
  now?: () => number;
  /** Log destination override (tests). Defaults to stdout. */
  logStream?: NodeJS.WritableStream;
  streamHubOptions?: Partial<HubOptions>;
}

/** API responses are JSON only; nothing here should ever be framed or execute script. */
const API_CSP = {
  defaultSrc: ["'none'"],
  frameAncestors: ["'none'"],
  baseUri: ["'none'"],
  formAction: ["'none'"],
};

function loggerOptions(config: ApiConfig, stream: NodeJS.WritableStream | undefined) {
  return {
    level: config.logLevel,
    ...(stream ? { stream } : {}),
    // PRD 16.3: no client IPs or headers in logs. Only method, path and request id.
    serializers: {
      req: (req: { method: string; url: string; id: string }) => ({ id: req.id, method: req.method, url: req.url }),
      res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
    },
    redact: ["req.headers", "req.remoteAddress", "req.ip"],
  };
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { config, repo } = deps;
  const now = deps.now ?? Date.now;
  const app = Fastify({
    logger: loggerOptions(config, deps.logStream),
    // One hop: req.ip is the address the edge proxy appended, so a client-supplied
    // X-Forwarded-For prefix cannot pick its own rate-limit key.
    trustProxy: config.trustProxy ? (_address: string, hop: number) => hop < 1 : false,
    bodyLimit: 16 * 1024,
    routerOptions: { maxParamLength: 200 },
  });

  registerErrorHandlers(app);

  await app.register(helmet, {
    contentSecurityPolicy: { useDefaults: false, directives: API_CSP },
    hsts: { maxAge: 63_072_000, includeSubDomains: true, preload: true },
    frameguard: { action: "deny" },
    crossOriginResourcePolicy: { policy: "cross-origin" },
    referrerPolicy: { policy: "no-referrer" },
  });

  await app.register(cors, {
    // Exact-match allow-list; an empty list means no browser origin is allowed.
    origin: (origin, cb) => cb(null, origin !== undefined && config.corsOrigins.includes(origin)),
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["content-type", "accept", "mcp-protocol-version", "mcp-session-id", "x-payment"],
    exposedHeaders: ["x-payment-response", "mcp-session-id"],
    maxAge: 600,
  });

  // In-memory store: counters live only for the current window and are never written anywhere.
  await app.register(rateLimit, {
    global: true,
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.windowMs,
    keyGenerator: (req) => req.ip,
    store: sweepingStoreClass(config.rateLimit.windowMs),
    errorResponseBuilder: () => new HttpError("rate_limited", "too many requests"),
  });

  const ctx: ReadContext = {
    repo,
    now,
    allowMock: config.allowMock,
    freshMs: config.freshMs,
    oracleMaxAgeSec: config.oracleMaxAgeSec,
    heartbeatMaxAgeMs: config.heartbeatMaxAgeMs,
  };

  for (const spec of PUBLIC_ROUTES) {
    app.get(spec.path, async (req, reply) => {
      // The table's union of schema types is too wide for inference; each entry was type-checked where declared.
      const query = parseInput<unknown>(spec.query as ZodTypeAny, req.query, "query");
      const params = parseInput<unknown>(spec.params as ZodTypeAny, req.params, "path");
      const handler = spec.handler as (c: ReadContext, q: unknown, p: unknown) => Promise<unknown>;
      const body = validated(spec.response as ZodTypeAny, await handler(ctx, query, params));
      void reply.header("cache-control", "public, max-age=0, s-maxage=2, stale-while-revalidate=5");
      return body;
    });
  }

  app.get("/healthz", { config: { rateLimit: false } }, async () => ({ ok: true }));

  await registerAdminRoutes(app, { config, repo, now });
  await registerStream(app, { config, ctx, ...(deps.streamHubOptions ? { hubOptions: deps.streamHubOptions } : {}) });
  await registerMcp(app, ctx);
  await registerDocs(app);

  return app;
}
