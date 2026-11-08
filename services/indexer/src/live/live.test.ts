import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "@strata/db";
import { freshTestDb, hasTestDb } from "../../test/db.js";
import type { InjectiveReader, RawDerivativeMarket } from "../injective/reader.js";
import { backfillTrades } from "./backfill.js";
import { dedupeOrders, LiveIndexer } from "./indexer.js";
import { mapOrder } from "./mappers.js";
import { IndexerOrder, IndexerTrade, type IndexerTrade as Trade } from "./records.js";

const fx = JSON.parse(readFileSync(new URL("../../test/fixtures/derivatives.mainnet.xau.json", import.meta.url), "utf8")) as {
  orders: { orders: unknown[] };
  trades: { trades: unknown[] };
};
const trades = fx.trades.trades.map((t) => IndexerTrade.parse(t));
const orders = fx.orders.orders.map((o) => IndexerOrder.parse(o));
const book = JSON.parse(readFileSync(new URL("../../test/fixtures/orderbook.mainnet.doge.json", import.meta.url), "utf8")) as { orderbook: { buys: never[]; sells: never[] } };
const XAU = trades[0]!.marketId;
const market: RawDerivativeMarket = {
  marketId: XAU, ticker: "XAU/USDC PERP", marketStatus: "active", isPerpetual: true, oracleType: "pythpro",
  oracleBase: "346", oracleQuote: "7", oracleScaleFactor: 0, quoteDenom: "usdc", quoteDecimals: 6, raw: {},
};

/** Replays recorded fixtures; pages trades newest-first by endTime like the Indexer. */
function fixtureReader(all: Trade[]): InjectiveReader {
  return {
    fetchMarkets: async () => [market],
    fetchOrderbooks: async (ids) => ids.map((marketId) => ({ marketId, sequence: 1, ...book.orderbook })),
    fetchOraclePrices: async () => [],
    streamOraclePrices: () => {},
    fetchTrades: async (q) =>
      [...all].sort((a, b) => b.executedAt - a.executedAt).filter((t) => (q.endTime === undefined || t.executedAt <= q.endTime) && (q.startTime === undefined || t.executedAt >= q.startTime)).slice(0, q.limit),
    fetchOrders: async () => orders,
    fetchPositions: async () => [],
    streamTrades: () => {},
    streamOrders: () => {},
    streamPositions: () => {},
  };
}

describe("dedupeOrders", () => {
  it("keeps one row per order and never loses a cancel", () => {
    const booked = mapOrder(orders[0]!, "testnet", 6, 1);
    const cancelled = { ...booked, cancelledAt: new Date(5) };
    expect(dedupeOrders([booked, cancelled, booked])).toEqual([cancelled]);
  });
});

describe.skipIf(!hasTestDb)("live ingestion (local TimescaleDB)", () => {
  let h: DbHandle;
  const agentSub = trades[0]!.subaccountId.toLowerCase();
  beforeAll(async () => {
    h = await freshTestDb("strata_w4_live_test");
    await h.sql`INSERT INTO agents (network, agent_id, name, kind, operator, inj_address, subaccount_id, market_ids, status, enrolled_at)
      VALUES ('testnet', 9, 'Agent #9', 'house', '0x0', 'inj1x', ${agentSub}, '[]'::jsonb, 'active', now())`;
  }, 60_000);
  afterAll(async () => h?.close());

  it("backfills trades and agent fills idempotently with small pages", async () => {
    const args = { network: "testnet" as const, reader: fixtureReader(trades), db: h.db, markets: [market], agentBySubaccount: new Map([[agentSub, 9]]), sinceMs: 0, untilMs: Date.now(), pageSize: 2 };
    const first = await backfillTrades(args);
    expect(first.insertedTrades).toBe(trades.length);
    const expectedFills = trades.filter((t) => t.subaccountId.toLowerCase() === agentSub).length;
    expect(first.insertedFills).toBe(expectedFills);
    const again = await backfillTrades(args);
    expect(again.insertedTrades).toBe(0);
    expect(again.insertedFills).toBe(0);
    const [{ n }] = (await h.sql`SELECT count(*)::int AS n FROM agent_fills WHERE agent_id = 9`) as unknown as [{ n: number }];
    expect(n).toBe(expectedFills);
  });

  it("snapshots arena books with STRATA depth and writes agent orders and a heartbeat", async () => {
    const idx = new LiveIndexer({ network: "testnet", reader: fixtureReader(trades), db: h.db, sql: h.sql, configuredArenaIds: [XAU], poller: null, snapshotWithoutAgents: false });
    await idx.refresh();
    await idx.flush();
    const n = await idx.snapshot(new Date(1_000_000));
    expect(n).toBe(1);
    expect(await idx.snapshot(new Date(1_000_000))).toBe(0);
    const [snap] = await h.sql`SELECT provenance, mid FROM book_snapshots WHERE network = 'testnet' AND market_id = ${XAU.toLowerCase()}`;
    expect(snap).toMatchObject({ provenance: "TESTNET", mid: "0.07135" });
    const [{ c }] = (await h.sql`SELECT count(*)::int AS c FROM agent_orders WHERE agent_id = 9`) as unknown as [{ c: number }];
    expect(c).toBe(orders.length);
    expect(idx.heartbeatDetail()).toMatchObject({ arenaMarkets: 1, agents: 1, snapshots: 1 });
    await idx.stop();
  });
});
