/**
 * Soak finding (2026-11-09): the indexer and baseline pools stopped writing for up to 2.5 h and
 * only a restart helped. Their write paths now report to a LivenessWatchdog; these tests use a
 * database handle whose every query fails, as the stuck pool did.
 */
import { describe, expect, it } from "vitest";
import { LivenessWatchdog, type Db, type Sql, type WatchdogTrip } from "@strata/db";
import { BaselineRecorder } from "../baseline/recorder.js";
import type { InjectiveReader } from "../injective/reader.js";
import { LiveIndexer } from "./indexer.js";

const failedQuery = () => Promise.reject(new Error("Failed query: insert into heartbeats"));
/** Every builder call chains and every await rejects, like a pool that has lost its sockets. */
const deadDb = new Proxy(() => undefined, {
  get: (_t, prop) => (prop === "then" ? (_res: unknown, rej: (e: unknown) => void) => void failedQuery().catch(rej) : deadDb),
  apply: () => deadDb,
}) as unknown as Db;

const reader: InjectiveReader = {
  fetchMarkets: async () => [],
  fetchOrderbooks: async () => [],
  fetchOraclePrices: async () => [],
  streamOraclePrices: () => {},
  fetchTrades: async () => [],
  fetchOrders: async () => [],
  fetchPositions: async () => [],
  streamTrades: () => {},
  streamOrders: () => {},
  streamPositions: () => {},
};

function watchdog() {
  const trips: WatchdogTrip[] = [];
  const w = new LivenessWatchdog({ maxConsecutiveFailures: 5, stallMs: 60_000, onTrip: (t) => void trips.push(t) });
  return { w, trips };
}

describe("indexer liveness", () => {
  it("trips the watchdog after 5 failed heartbeat writes in a row", async () => {
    const { w, trips } = watchdog();
    const idx = new LiveIndexer({ network: "testnet", reader, db: deadDb, sql: {} as Sql, configuredArenaIds: [], poller: null, liveness: w });
    for (let i = 0; i < 4; i++) await expect(idx.heartbeat()).rejects.toThrow("Failed query");
    expect(trips).toEqual([]);
    await expect(idx.heartbeat()).rejects.toThrow("Failed query");
    expect(trips).toEqual([expect.objectContaining({ reason: "consecutive_failures", failures: 5 })]);
  });
});

describe("baseline liveness", () => {
  it("trips the watchdog after 5 failed sample ticks in a row", async () => {
    const { w, trips } = watchdog();
    const rec = new BaselineRecorder({ network: "testnet", reader, db: deadDb, source: "test", configured: [], refreshMarketsMs: Number.MAX_SAFE_INTEGER, liveness: w });
    for (let i = 0; i < 5; i++) await rec.tick();
    expect(trips).toEqual([expect.objectContaining({ reason: "consecutive_failures", failures: 5 })]);
  });
});
