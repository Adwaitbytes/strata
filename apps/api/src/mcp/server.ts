/**
 * MCP server (PRD 13) over Streamable HTTP at /mcp, stateless: each POST builds a fresh
 * server and transport, so it runs unchanged on serverless instances. Tools are read-only
 * except strata_prepare_enrollment, which only returns unsigned transaction data.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import { NETWORKS } from "@strata/config";
import { Hex32, NetworkName } from "@strata/sdk";
import { errorBody, HttpError } from "../errors.js";
import { getAgentDetail, getLeaderboard, getMarketDetail, type ReadContext } from "../services/read.js";
import { prepareEnrollment } from "./enrollment.js";
import { RISK_RULES, SCORING_RULES } from "./rules.js";

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

const ok = (value: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(value) }] });
const fail = (message: string): ToolResult => ({ content: [{ type: "text", text: message }], isError: true });

/** Expected failures (not found, bad input, data unavailable) become tool errors with safe text. */
async function guarded(fn: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof HttpError) return fail(err.message);
    return fail("STRATA data is temporarily unavailable");
  }
}

const network = NetworkName.default("testnet").describe("mainnet or testnet (default testnet)");

export function createMcpServer(ctx: ReadContext): McpServer {
  const server = new McpServer({ name: "strata", version: "1.0.0" });

  server.registerTool(
    "strata_get_leaderboard",
    {
      description: "Current STRATA season leaderboard: agents ranked by the latest attested epoch score, with spread, depth, uptime and PnL. Every row carries network and provenance.",
      inputSchema: { network, season: z.number().int().nonnegative().optional().describe("Season number; latest when omitted") },
      annotations: { readOnlyHint: true },
    },
    ({ network: n, season }) => guarded(async () => ok(await getLeaderboard(ctx, n, season))),
  );

  server.registerTool(
    "strata_get_market_liquidity",
    {
      description: "Spread, depth within 25 bps, STRATA share of book depth, baseline before STRATA, 24h history and oracle health for one Injective derivative market.",
      inputSchema: { network, marketId: Hex32.describe("Injective derivative market ID (0x + 64 hex)") },
      annotations: { readOnlyHint: true },
    },
    ({ network: n, marketId }) => guarded(async () => ok(await getMarketDetail(ctx, n, marketId))),
  );

  server.registerTool(
    "strata_get_agent",
    {
      description: "One arena agent: profile, live quotes, recent fills, epoch scores, guard events, AI tuner feed and limits.",
      inputSchema: { network, agentId: z.number().int().positive() },
      annotations: { readOnlyHint: true },
    },
    ({ network: n, agentId }) => guarded(async () => ok(await getAgentDetail(ctx, n, agentId))),
  );

  server.registerTool(
    "strata_get_rules",
    {
      description: "The published STRATA scoring formula, anti-gaming rules and agent risk guards.",
      annotations: { readOnlyHint: true },
    },
    async () => ({ content: [{ type: "text", text: `${SCORING_RULES}\n${RISK_RULES}` }] }),
  );

  server.registerTool(
    "strata_prepare_enrollment",
    {
      description: "Build the unsigned StrataArena.enroll transaction for an agent operator. Returns calldata only; STRATA never signs or holds keys.",
      inputSchema: {
        network,
        erc8004Id: z.string().regex(/^\d{1,78}$/).describe("ERC-8004 identity token ID owned by the operator"),
        subaccountId: Hex32.describe("Injective subaccount ID the agent trades from"),
        metadataURI: z.string().max(512).describe("Agent metadata URI"),
      },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ network: n, erc8004Id, subaccountId, metadataURI }) => {
      const arena = NETWORKS[n].contracts.arena;
      if (!arena) return fail(`StrataArena is not deployed on ${n} yet, so enrollment data cannot be prepared.`);
      return ok(prepareEnrollment(n, arena, { erc8004Id, subaccountId, metadataURI }));
    },
  );

  server.registerResource(
    "scoring",
    "strata://rules/scoring",
    { title: "STRATA scoring rules", mimeType: "text/plain" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/plain", text: SCORING_RULES }] }),
  );
  server.registerResource(
    "risk",
    "strata://rules/risk",
    { title: "STRATA risk guards", mimeType: "text/plain" },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: "text/plain", text: RISK_RULES }] }),
  );

  return server;
}

export async function registerMcp(app: FastifyInstance, ctx: ReadContext): Promise<void> {
  app.post("/mcp", async (req, reply) => {
    const server = createMcpServer(ctx);
    // No sessionIdGenerator: stateless mode, as the SDK documents for serverless hosts.
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });
    // Hijacked responses skip onSend, so carry over the security and CORS headers already set.
    for (const [k, v] of Object.entries(reply.getHeaders())) if (v !== undefined) reply.raw.setHeader(k, v);
    reply.hijack();
    reply.raw.on("close", () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req.raw, reply.raw, req.body);
    } catch (err) {
      req.log.error({ err }, "mcp request failed");
      if (!reply.raw.headersSent) {
        reply.raw.writeHead(500, { "content-type": "application/json" });
        reply.raw.end(JSON.stringify(errorBody("internal", "internal error")));
      }
    }
  });

  // Stateless server: no server-initiated streams or sessions to resume or delete.
  const notAllowed = async (_req: FastifyRequest, reply: FastifyReply) => {
    void reply.status(405).header("allow", "POST");
    return errorBody("bad_request", "use POST for MCP requests");
  };
  app.get("/mcp", notAllowed);
  app.delete("/mcp", notAllowed);
}
