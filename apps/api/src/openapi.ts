/**
 * OpenAPI 3 document generated from the same zod schemas the server validates with
 * (PRD 11.2), served as JSON at /docs/json and as a script-free HTML reference at /docs.
 * Swagger UI was dropped: its static-file server (@fastify/static) is either vulnerable
 * (GHSA-83w8-p2f5-377r, GHSA-8pvw-jcv7-9cmj in 9.x) or fails to boot on Vercel (10.x).
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import { OpenAPIRegistry, OpenApiGeneratorV3, extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import { ApiError, KillRequest, NetworkName, WsClientMessage, WsServerMessage } from "@strata/sdk";
import { PUBLIC_ROUTES } from "./routes/table.js";
import { KillAccepted } from "./routes/admin.js";

extendZodWithOpenApi(z);

/** The docs page is plain HTML with inline styles only: no scripts, no external loads. */
const DOCS_CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "script-src 'none'",
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

type OpenApiDocument = ReturnType<OpenApiGeneratorV3["generateDocument"]>;

const escapeHtml = (v: unknown): string =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

const METHODS = ["get", "post", "put", "patch", "delete"] as const;

/** Server-rendered endpoint reference built from the same OpenAPI document. */
export function renderDocsPage(doc: Pick<OpenApiDocument, "info" | "paths"> & { openapi: string }): string {
  const rows: string[] = [];
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    for (const method of METHODS) {
      const op = (item as Record<string, { summary?: string; description?: string } | undefined>)[method];
      if (!op) continue;
      rows.push(
        `<tr><td class="m ${method}">${method.toUpperCase()}</td><td class="p">${escapeHtml(path)}</td>` +
          `<td>${escapeHtml(op.summary ?? op.description ?? "")}</td></tr>`,
      );
    }
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(doc.info.title)}</title>
<style>
body{margin:0;background:#0D0F0E;color:#ECE8DF;font:15px/1.55 ui-sans-serif,system-ui,sans-serif}
main{max-width:960px;margin:0 auto;padding:48px 20px}
h1{font-size:32px;margin:0 0 8px;letter-spacing:-.01em}
p{color:#B9B4A8;margin:0 0 24px}
a{color:#E9A94B}
table{width:100%;border-collapse:collapse}
td{padding:10px 8px;border-top:1px solid #2A2D2A;vertical-align:top}
.m{font:600 12px/1.6 ui-monospace,monospace;width:64px}
.get{color:#5CD69A}.post{color:#E9A94B}
.p{font:13px/1.6 ui-monospace,monospace;white-space:nowrap}
</style></head><body><main>
<h1>${escapeHtml(doc.info.title)}</h1>
<p>${escapeHtml(doc.info.description ?? "")} OpenAPI ${escapeHtml(doc.openapi)}: <a href="/docs/json">/docs/json</a></p>
<table><tbody>${rows.join("")}</tbody></table>
</main></body></html>`;
}

export async function registerDocs(app: FastifyInstance): Promise<void> {
  const document = buildOpenApiDocument();
  const page = renderDocsPage(document);
  const sendPage = async (_req: unknown, reply: FastifyReply) =>
    reply.header("content-security-policy", DOCS_CSP).type("text/html; charset=utf-8").send(page);
  app.get("/docs/json", async () => document);
  app.get("/docs", sendPage);
  app.get("/docs/", sendPage);
}
