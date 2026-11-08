/**
 * OpenAPI 3 document generated from the same zod schemas the server validates with
 * (PRD 11.2), served as JSON at /docs/json and as Swagger UI at /docs.
 */
import type { FastifyInstance } from "fastify";
import swagger, { type StaticDocumentSpec } from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { OpenAPIRegistry, OpenApiGeneratorV3, extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { ApiError, KillRequest, NetworkName, WsClientMessage, WsServerMessage } from "@strata/sdk";
import { PUBLIC_ROUTES } from "./routes/table.js";
import { KillAccepted } from "./routes/admin.js";

extendZodWithOpenApi(z);

/** Swagger UI ships same-origin scripts and sets inline styles; nothing loads from elsewhere. */
const DOCS_CSP = [
  "default-src 'self'",
  "img-src 'self' data:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

const json = (schema: z.ZodTypeAny, description: string) => ({ description, content: { "application/json": { schema } } });

const errorResponses = {
  400: json(ApiError, "Invalid input"),
  429: json(ApiError, "Rate limited"),
  503: json(ApiError, "Data store unavailable"),
};

export function buildOpenApiDocument(): ReturnType<OpenApiGeneratorV3["generateDocument"]> {
  const registry = new OpenAPIRegistry();
  registry.register("ApiError", ApiError);

  for (const r of PUBLIC_ROUTES) {
    const hasParams = Object.keys(r.params.shape).length > 0;
    registry.registerPath({
      method: "get",
      path: r.path.replace(/:([a-z]+)/g, "{$1}"),
      summary: r.summary,
      tags: [r.tag],
      request: { query: r.query, ...(hasParams ? { params: r.params } : {}) },
      responses: {
        200: json(r.response, "OK. Every number carries network and provenance."),
        ...(hasParams ? { 404: json(ApiError, "Not found") } : {}),
        ...errorResponses,
      },
    });
  }

  registry.registerPath({
    method: "post",
    path: "/v1/admin/kill",
    summary: "Kill switch. Body is signed by the owner wallet (EIP-191) over the canonical message; nonce is single use.",
    tags: ["admin"],
    request: { body: { content: { "application/json": { schema: KillRequest } } } },
    responses: { 202: json(KillAccepted, "Kill command recorded"), 401: json(ApiError, "Bad signature, expired or reused nonce"), ...errorResponses },
  });

  registry.registerPath({
    method: "get",
    path: "/v1/stream/sse",
    summary: "Server-Sent Events fallback for ws /v1/stream. Each event's data is a WsServerMessage.",
    tags: ["stream"],
    request: {
      query: z.object({
        network: NetworkName.default("mainnet"),
        channels: z.string().openapi({ description: "Comma-separated channels: book:<marketId>, agent:<agentId>, leaderboard, events", example: "leaderboard,events" }),
      }),
    },
    responses: { 200: { description: "text/event-stream of WsServerMessage", content: { "text/event-stream": { schema: WsServerMessage } } }, ...errorResponses },
  });

  registry.register("WsClientMessage", WsClientMessage);
  registry.register("WsServerMessage", WsServerMessage);

  return new OpenApiGeneratorV3(registry.definitions).generateDocument({
    openapi: "3.0.3",
    info: {
      title: "STRATA API",
      version: "1.0.0",
      description:
        "Public read API for the STRATA liquidity arena on Injective. Live updates: ws /v1/stream " +
        "(send WsClientMessage, receive WsServerMessage, at most 4 updates per second per channel).",
    },
  });
}

export async function registerDocs(app: FastifyInstance): Promise<void> {
  // Same JSON, two OpenAPI typings (openapi3-ts vs openapi-types) that disagree only on optional-property strictness.
  const document = buildOpenApiDocument() as unknown as StaticDocumentSpec["document"];
  await app.register(swagger, { mode: "static", specification: { document } });
  await app.register(swaggerUi, { routePrefix: "/docs", staticCSP: false, uiConfig: { docExpansion: "list", deepLinking: false } });
  app.addHook("onSend", async (req, reply, payload) => {
    if (req.url === "/docs" || req.url.startsWith("/docs/")) void reply.header("content-security-policy", DOCS_CSP);
    return payload;
  });
}
