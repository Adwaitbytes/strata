/**
 * Runs the Postgres repository and the full app against a real database.
 * Opt-in: set TEST_DATABASE_URL to a database whose name ends in `_test`. The public schema of
 * that database is dropped and rebuilt from packages/db/migrations on every run.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { killRequestMessage, AgentDetailResponse, EpochResponse, HeroStatsResponse, LeaderboardResponse, MarketDetailResponse, MarketsResponse, StatusResponse } from "@strata/sdk";
import { schema } from "@strata/db";
import { connect, DrizzleRepository, type DbConnection } from "../src/repo/drizzle.js";
import { buildApp } from "../src/create-app.js";
import { testConfig } from "./support/config.js";
import { HEX32, MARKET_A, agent, market, score, attestation } from "./support/fixtures.js";

const url = process.env["TEST_DATABASE_URL"];
const enabled = url !== undefined && new URL(url).pathname.endsWith("_test");
const migrationsDir = fileURLToPath(new URL("../../../packages/db/migrations", import.meta.url));

describe.skipIf(!enabled)("DrizzleRepository against Postgres", () => {
  let conn: DbConnection;
  let repo: DrizzleRepository;
  const invalid: string[] = [];
  const now = Date.now();

  beforeAll(async () => {
    const admin = postgres(url as string, { max: 1, onnotice: () => {} });
    await admin.unsafe("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await admin.unsafe("DROP TYPE IF EXISTS network, provenance CASCADE;");
    for (const f of readdirSync(migrationsDir).filter((x) => x.endsWith(".sql")).sort()) {
      await admin.unsafe(readFileSync(join(migrationsDir, f), "utf8"));
    }
    await admin.end();

    conn = connect(url as string, 2);
    repo = new DrizzleRepository(conn.db, { onInvalidRow: (t, i) => invalid.push(`${t}: ${i}`) });
    const { db } = conn;
    const m = market();
    await db.insert(schema.markets).values({ network: "testnet", marketId: m.marketId, ticker: m.ticker, data: m, arenaEnabled: true, fetchedAt: new Date(m.fetchedAt) });
    const a = agent(1);
    await db.insert(schema.agents).values({
      network: "testnet", agentId: 1, name: a.name, kind: a.kind, operator: a.operator, injAddress: a.injAddress,
      subaccountId: a.subaccountId, marketIds: a.marketIds, status: "active", enrolledAt: new Date(a.enrolledAt),
    });
    const snap = (at: number, provenance: "TESTNET" | "BASELINE", spread: number) => ({
      network: "testnet" as const, marketId: MARKET_A, at: new Date(at), provenance, mid: "100", spreadBps: spread,
      depthUsd25: 2000, strataDepthUsd25: provenance === "BASELINE" ? 0 : 800,
      bids: [{ price: "99.9", quantity: "10", strataQuantity: "4" }], asks: [{ price: "100.1", quantity: "10", strataQuantity: "4" }],
      oraclePrice: "100.01", oracleTs: new Date(at - 500), sessionState: "open",
    });
    await db.insert(schema.bookSnapshots).values([snap(now - 3 * 3_600_000, "BASELINE", 30), snap(now - 3 * 3_600_000 + 5_000, "BASELINE", 32), snap(now - 2_000, "TESTNET", 18)]);
    await db.insert(schema.oraclePrices).values({ network: "testnet", marketId: MARKET_A, source: "pyth", at: new Date(now - 1_000), price: "100.01", oracleTs: new Date(now - 3_000) });
    await db.insert(schema.agentOrders).values({ network: "testnet", agentId: 1, marketId: MARKET_A, orderHash: "0xabc", side: "buy", price: "99.9", quantity: "1", level: 0, postedAt: new Date(now - 1_000), provenance: "TESTNET" });
    const s = score(1, 3, 8100);
    await db.insert(schema.scores).values({ network: "testnet", season: 0, epoch: 3, agentId: 1, score: s.score, metrics: s.metrics, flags: 0, leaf: s.leaf, proof: s.proof, provenance: "TESTNET" });
    const e = attestation(0, 3);
    await db.insert(schema.epochs).values({ network: "testnet", season: 0, epoch: 3, startTime: new Date(e.startTime), endTime: new Date(e.endTime), merkleRoot: e.merkleRoot, dataUri: e.dataURI, txHash: e.txHash, postedAt: new Date(e.postedAt as number), contract: e.contract });
    await db.insert(schema.heartbeats).values({ network: "testnet", service: "indexer", at: new Date(now - 2_000), detail: { lastBlockHeight: 123456 } });
    // A row that violates the schema must be dropped, not served.
    await db.insert(schema.guardEvents).values({ id: "bad", network: "testnet", provenance: "TESTNET", agentId: 1, marketId: HEX32("a"), guard: "not-a-guard", action: "halt", reason: "oracle_stale", detail: "x", observed: {}, at: new Date(now - 1_000) });
  });

  afterAll(async () => {
    await conn?.close();
  });

  it("serves every read route with schema-valid payloads from real rows", async () => {
    const app = await buildApp({ config: testConfig(), repo });
    const get = async (u: string) => (await app.inject({ method: "GET", url: u })).json();
    const markets = MarketsResponse.parse(await get("/v1/markets?network=testnet"));
    expect(markets.markets[0]?.now?.spreadBps).toBe(18);
    expect(markets.markets[0]?.baseline).toMatchObject({ spreadBps: 31, samples: 2 });

    const detail = MarketDetailResponse.parse(await get(`/v1/markets/${MARKET_A}?network=testnet`));
    expect(detail.oracle.healthy).toBe(true);
    expect(detail.history.length).toBeGreaterThanOrEqual(2);

    const hero = HeroStatsResponse.parse(await get("/v1/stats?network=testnet"));
    expect(hero).toMatchObject({ agentsLive: 1, marketsCovered: 1, strataDepthUsd25: 800, spreadImprovementBps: 13 });

    const board = LeaderboardResponse.parse(await get("/v1/leaderboard?network=testnet"));
    expect(board.rows[0]).toMatchObject({ agentId: 1, rank: 1, score: 8100 });

    const ep = EpochResponse.parse(await get("/v1/epochs/0/3?network=testnet"));
    expect(ep.scores[0]?.flagNames).toEqual([]);

    const ag = AgentDetailResponse.parse(await get("/v1/agents/1?network=testnet"));
    expect(ag.liveQuotes).toHaveLength(1);
    expect(ag.guardEvents).toHaveLength(0);
    expect(invalid.some((x) => x.startsWith("guard_events"))).toBe(true);

    const status = StatusResponse.parse(await get("/v1/status?network=testnet"));
    expect(status.lastBlockHeight).toBe(123456);
    await app.close();
  });

  it("records a signed kill command once and rejects the replay", async () => {
    const owner = privateKeyToAccount(generatePrivateKey());
    const app = await buildApp({ config: testConfig({ STRATA_OWNER_ADDRESS: owner.address }), repo });
    const u = { target: "all" as const, closePositions: true, network: "testnet" as const, nonce: `it-${now}-abcdefgh`, expiresAt: Date.now() + 60_000 };
    const payload = { ...u, signature: await owner.signMessage({ message: killRequestMessage(u) }) };
    expect((await app.inject({ method: "POST", url: "/v1/admin/kill", payload })).statusCode).toBe(202);
    expect((await app.inject({ method: "POST", url: "/v1/admin/kill", payload })).statusCode).toBe(401);
    const rows = await conn.db.select().from(schema.killCommands);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ targetAgentId: null, closePositions: true, network: "testnet" });
    await app.close();
  });
});
