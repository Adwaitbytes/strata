/**
 * Postgres integration test for PgScorerStore. Creates a throwaway database, applies every
 * migration in packages/db, loads the golden fixture through real SQL, and checks that the
 * scorer reproduces the golden root from database rows. Runs only when
 * SCORER_IT_DATABASE_URL_FILE points at a file holding a server URL with CREATEDB rights, e.g.
 *   SCORER_IT_DATABASE_URL_FILE=../../.secrets/local_db_url pnpm --filter @strata/scorer test
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import postgres from "postgres";
import { agentFills, agentOrders, agents, bookSnapshots, createDb, epochs, loadMigrations, migrate, scores, type DbHandle } from "@strata/db";
import { eq } from "drizzle-orm";
import { computeEpoch, epochWindow } from "../src/epoch.js";
import { DEFAULT_PARAMS } from "../src/params.js";
import { PgScorerStore } from "../src/store.js";
import { EPOCH, FIXTURE, SEASON } from "./fixtures/epochFixture.js";

const urlFile = process.env.SCORER_IT_DATABASE_URL_FILE;
const GOLDEN_ROOT = "0xdd4f9e94db975b5d21af83f6d1fdfcf6a833621676c80020fedf81d79280f3a9";
const MIGRATIONS = fileURLToPath(new URL("../../../packages/db/migrations", import.meta.url));

describe.skipIf(!urlFile)("PgScorerStore (Postgres)", () => {
  const dbName = `strata_scorer_it_${process.pid}_${Date.now()}`;
  let admin: postgres.Sql;
  let handle: DbHandle;
  let store: PgScorerStore;

  beforeAll(async () => {
    const serverUrl = readFileSync(urlFile!, "utf8").trim();
    admin = postgres(serverUrl, { max: 1, onnotice: () => {} });
    await admin.unsafe(`CREATE DATABASE ${dbName}`);
    const u = new URL(serverUrl);
    u.pathname = `/${dbName}`;
    handle = createDb(u.toString(), { max: 2 });
    await migrate(handle.sql, loadMigrations(MIGRATIONS));
    store = new PgScorerStore(handle.db, "testnet", FIXTURE.markets);

    const db = handle.db;
    await db.insert(agents).values(
      FIXTURE.agents.map((a) => ({
        network: "testnet" as const,
        agentId: a.agentId,
        name: `agent-${a.agentId}`,
        kind: "house",
        operator: a.operator,
        injAddress: "inj1test",
        subaccountId: a.subaccountId,
        marketIds: a.marketIds,
        status: a.status,
        simulated: a.simulated,
        enrolledAt: new Date(a.enrolledAt),
      })),
    );
    for (const [marketId, samples] of FIXTURE.book) {
      await db.insert(bookSnapshots).values(
        samples.map((b) => ({
          network: "testnet" as const,
          marketId,
          at: new Date(b.at),
          provenance: "TESTNET" as const,
          mid: b.mid === null ? null : String(b.mid),
          spreadBps: b.spreadBps,
          depthUsd25: b.depthUsd25,
          strataDepthUsd25: 0,
          bids: [],
          asks: [],
          sessionState: "always_open",
        })),
      );
      // Baseline rows well before any agent order: mean spread equals the fixture baseline.
      await db.insert(bookSnapshots).values({
        network: "testnet",
        marketId,
        at: new Date(SEASON.startMs - 86_400_000),
        provenance: "BASELINE",
        mid: "1",
        spreadBps: FIXTURE.baselineSpreadBps.get(marketId)!,
        depthUsd25: 0,
        strataDepthUsd25: 0,
        bids: [],
        asks: [],
        sessionState: "always_open",
      });
    }
    await db.insert(agentOrders).values(
      FIXTURE.orders.map((o) => ({
        network: "testnet" as const,
        agentId: o.agentId,
        marketId: o.marketId,
        orderHash: o.orderHash,
        side: o.side,
        price: String(o.price),
        quantity: String(o.quantity),
        level: 0,
        postedAt: new Date(o.postedAt),
        cancelledAt: o.cancelledAt === null ? null : new Date(o.cancelledAt),
        provenance: "TESTNET" as const,
      })),
    );
    await db.insert(agentFills).values(
      FIXTURE.fills.map((f) => {
        const [txHash, idx] = f.id.split(":");
        return {
          network: "testnet" as const,
          agentId: f.agentId,
          marketId: f.marketId,
          orderHash: f.orderHash,
          tradeId: f.id,
          txHash: txHash!,
          eventIndex: Number(idx),
          side: f.side,
          price: String(f.price),
          quantity: String(f.quantity),
          feeUsd: f.feeUsd,
          isMaker: f.isMaker,
          counterpartySubaccountId: f.counterpartySubaccountId,
          executedAt: new Date(f.executedAt),
          provenance: "TESTNET" as const,
        };
      }),
    );
  }, 60_000);

  afterAll(async () => {
    await handle?.close();
    if (admin) {
      await admin.unsafe(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await admin.end({ timeout: 5 });
    }
  });

  it("loads the fixture from SQL and reproduces the golden root", async () => {
    const data = await store.loadEpochData(epochWindow(SEASON, EPOCH), SEASON);
    expect(data.baselineSpreadBps.get(FIXTURE.markets[0]!.marketId)).toBe(18);
    const r = computeEpoch(data, DEFAULT_PARAMS);
    if (r.kind !== "scored") throw new Error(r.reason);
    expect(r.merkleRoot).toBe(GOLDEN_ROOT);
  });

  it("persists epochs, scores and the run cursor through the posting lifecycle", async () => {
    const data = await store.loadEpochData(epochWindow(SEASON, EPOCH), SEASON);
    const r = computeEpoch(data, DEFAULT_PARAMS);
    if (r.kind !== "scored") throw new Error(r.reason);
    const contract = "0x00000000000000000000000000000000000c0c0c";
    const save = { window: data.window, merkleRoot: r.merkleRoot, dataUri: "https://x/v1/epochs/1/2#keccak256=0x00", documentHash: r.merkleRoot, contract, scores: r.scores, evidence: r.evidence, breakdown: r.breakdown } as const;
    await store.recordSkipped(1, 0, "no book data for any arena market in the epoch window");
    await store.saveScored(save);
    await store.saveScored(save);
    expect(await store.nextEpochToProcess(1, ["posted", "skipped"])).toBe(1);
    expect((await store.getRun(1, EPOCH))?.status).toBe("computed");
    expect(await handle.db.select().from(scores).where(eq(scores.epoch, EPOCH))).toHaveLength(5);

    const tx = ("0x" + "12".repeat(32)) as `0x${string}`;
    await store.recordSubmitted(1, EPOCH, tx);
    await store.recordFailure(1, EPOCH, "receipt not found");
    await store.recordFailure(1, EPOCH, "receipt not found");
    expect(await store.getRun(1, EPOCH)).toMatchObject({ status: "failed", txHash: tx, attempts: 2 });

    await store.recordPosted(1, EPOCH, tx, 1_765_000_000_000);
    expect(await store.getRun(1, EPOCH)).toMatchObject({ status: "posted", txHash: tx, reason: null });
    expect(await store.nextEpochToProcess(1, ["posted", "skipped"])).toBe(EPOCH + 1);
    const [row] = await handle.db.select().from(epochs).where(eq(epochs.epoch, EPOCH));
    expect(row).toMatchObject({ merkleRoot: r.merkleRoot, txHash: tx, contract });
    expect(row!.postedAt?.getTime()).toBe(1_765_000_000_000);

    // A posted epoch row is never rewritten.
    await store.saveScored({ ...save, merkleRoot: ("0x" + "99".repeat(32)) as `0x${string}` });
    const [after] = await handle.db.select().from(epochs).where(eq(epochs.epoch, EPOCH));
    expect(after!.merkleRoot).toBe(r.merkleRoot);
  });

  it("writes a heartbeat", async () => {
    await store.heartbeat({ lastTick: 1 });
    await store.heartbeat({ lastTick: 2 });
  });
});
