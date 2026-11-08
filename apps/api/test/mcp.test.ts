import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { decodeFunctionData } from "viem";
import { LeaderboardResponse, MarketDetailResponse, strataArenaAbi } from "@strata/sdk";
import { buildApp } from "../src/create-app.js";
import { prepareEnrollment } from "../src/mcp/enrollment.js";
import { MemoryRepo } from "./support/memory-repo.js";
import { testConfig } from "./support/config.js";
import { HEX32, MARKET_A, NOW, agent, book, market, score } from "./support/fixtures.js";

let app: FastifyInstance;
let client: Client;

function textOf(result: unknown): string {
  const content = (result as { content: Array<{ type: string; text?: string }> }).content;
  return content.map((c) => c.text ?? "").join("");
}

beforeAll(async () => {
  const repo = new MemoryRepo();
  repo.data.agents = [agent(1)];
  repo.data.scores = [score(1, 1, 7000)];
  repo.data.markets = [market()];
  repo.data.books = [book(MARKET_A, NOW - 1_000)];
  app = await buildApp({ config: testConfig(), repo, now: () => NOW });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  if (addr === null || typeof addr === "string") throw new Error("no address");
  client = new Client({ name: "strata-test", version: "0.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${addr.port}/mcp`)));
});

afterAll(async () => {
  await client.close();
  await app.close();
});

describe("MCP server at /mcp", () => {
  it("lists the five STRATA tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "strata_get_agent",
      "strata_get_leaderboard",
      "strata_get_market_liquidity",
      "strata_get_rules",
      "strata_prepare_enrollment",
    ]);
  });

  it("returns the leaderboard in the REST contract shape", async () => {
    const res = await client.callTool({ name: "strata_get_leaderboard", arguments: { network: "testnet" } });
    const body = LeaderboardResponse.parse(JSON.parse(textOf(res)));
    expect(body.rows[0]?.agentId).toBe(1);
  });

  it("returns market liquidity", async () => {
    const res = await client.callTool({ name: "strata_get_market_liquidity", arguments: { network: "testnet", marketId: MARKET_A } });
    expect(MarketDetailResponse.parse(JSON.parse(textOf(res))).summary.now?.spreadBps).toBe(20);
  });

  it("reports an unknown agent as a tool error, not a crash", async () => {
    const res = await client.callTool({ name: "strata_get_agent", arguments: { network: "testnet", agentId: 99 } });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("agent not found");
  });

  it("returns the published scoring and risk rules", async () => {
    const text = textOf(await client.callTool({ name: "strata_get_rules", arguments: {} }));
    expect(text).toContain("score     = round(10000 * liquidity * (0.7 + 0.3 * quality))");
    expect(text).toContain("Oracle Guard");
  });

  it("declines to prepare enrollment while the arena contract is not deployed", async () => {
    const res = await client.callTool({
      name: "strata_prepare_enrollment",
      arguments: { network: "testnet", erc8004Id: "12", subaccountId: HEX32("c"), metadataURI: "ipfs://x" },
    });
    expect(res.isError).toBe(true);
    expect(textOf(res)).toContain("not deployed");
  });

  it("exposes scoring and risk resources", async () => {
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri).sort()).toEqual(["strata://rules/risk", "strata://rules/scoring"]);
  });
});

describe("prepareEnrollment", () => {
  it("encodes an unsigned legacy enroll transaction for the arena", () => {
    const arena = `0x${"4".repeat(40)}` as const;
    const tx = prepareEnrollment("testnet", arena, { erc8004Id: "12", subaccountId: HEX32("c"), metadataURI: "ipfs://meta" });
    expect(tx).toMatchObject({ chainId: 1439, to: arena, value: "0", type: "legacy", gasPrice: "160000000" });
    const decoded = decodeFunctionData({ abi: strataArenaAbi, data: tx.data });
    expect(decoded.functionName).toBe("enroll");
    expect(decoded.args).toEqual([12n, HEX32("c"), "ipfs://meta"]);
  });
});
