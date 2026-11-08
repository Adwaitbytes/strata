import { readFileSync } from "node:fs";
import { getMarkets } from "@strata/config";
import { Market } from "@strata/sdk";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "@strata/db";
import { freshTestDb, hasTestDb } from "../../test/db.js";
import type { InjectiveReader, RawDerivativeMarket } from "../injective/reader.js";
import { LiveIndexer } from "../live/indexer.js";
import { mapOrder } from "../live/mappers.js";
import { IndexerOrder } from "../live/records.js";
import { upsertMarketCatalog } from "./catalog.js";
import { closeOrdersMissingFromChain } from "./reconcile.js";

const fx = JSON.parse(readFileSync(new URL("../../test/fixtures/derivatives.mainnet.xau.json", import.meta.url), "utf8")) as { orders: { orders: unknown[] } };
const chainOrders = fx.orders.orders.map((o) => IndexerOrder.parse(o));
const XAU = chainOrders[0]!.marketId;
const SUB = chainOrders[0]!.subaccountId.toLowerCase();

describe("mapOrder terminal states", () => {
  it("closes the row for filled, cancelled and expired orders, keeps booked open", () => {
    const base = chainOrders[0]!;
    for (const state of ["filled", "canceled", "expired"]) {
      expect(mapOrder({ ...base, state, updatedAt: 1234 }, "testnet", 6, 1).cancelledAt).toEqual(new Date(1234));
    }
    expect(mapOrder({ ...base, state: "partial_filled" }, "testnet", 6, 1).cancelledAt).toBeNull();
  });
});

describe.skipIf(!hasTestDb)("order reconciliation (local TimescaleDB)", () => {
  let h: DbHandle;
  const now = new Date("2026-11-09T12:00:00Z");
  const ins = (hash: string, posted: Date, cancelled: Date | null) =>
    h.sql`INSERT INTO agent_orders (network, agent_id, market_id, order_hash, side, price, quantity, level, posted_at, cancelled_at, provenance)
      VALUES ('testnet', 1, ${XAU}, ${hash}, 'buy', 1, 1, 0, ${posted}, ${cancelled}, 'TESTNET')`;

  beforeAll(async () => {
    h = await freshTestDb("strata_w4_reconcile_test");
  }, 60_000);
  afterAll(async () => h?.close());

  it("closes rows that left the book and duplicate rows, keeps live and in-grace rows, idempotently", async () => {
    const old = new Date(now.getTime() - 600_000);
    await ins("0xaaa", old, null); // on chain, canonical
    await ins("0xaaa", new Date(old.getTime() - 1000), null); // same order, earlier writer's posted_at
    await ins("0xbbb", old, null); // gone from chain
    await ins("0xccc", new Date(now.getTime() - 5_000), null); // posted inside grace
    await ins("0xddd", old, new Date(old.getTime() + 1000)); // already closed
    const args = { network: "testnet" as const, agentId: 1, open: [{ orderHash: "0xAAA", postedAt: old }], observedAt: now };
    expect(await closeOrdersMissingFromChain(h.sql, args)).toBe(2);
    const open = await h.sql<{ order_hash: string }[]>`SELECT order_hash FROM agent_orders WHERE agent_id = 1 AND cancelled_at IS NULL ORDER BY 1`;
    expect(open.map((r) => r.order_hash)).toEqual(["0xaaa", "0xccc"]);
    const [closed] = await h.sql<{ cancelled_at: Date }[]>`SELECT cancelled_at FROM agent_orders WHERE order_hash = '0xbbb'`;
    expect(closed?.cancelled_at.getTime()).toBe(now.getTime());
    expect(await closeOrdersMissingFromChain(h.sql, args)).toBe(0);
  });

  it("indexer refresh makes DB-open orders equal the chain's open orders", async () => {
    await h.sql`INSERT INTO agents (network, agent_id, name, kind, operator, inj_address, subaccount_id, market_ids, status, enrolled_at)
      VALUES ('testnet', 7, 'Agent #7', 'house', '0x0', 'inj1x', ${SUB}, '[]'::jsonb, 'active', now())`;
    const stale = new Date(Date.now() - 3_600_000);
    await h.sql`INSERT INTO agent_orders (network, agent_id, market_id, order_hash, side, price, quantity, level, posted_at, provenance)
      VALUES ('testnet', 7, ${XAU}, '0xstale', 'buy', 1, 1, 0, ${stale}, 'TESTNET')`;
    const market: RawDerivativeMarket = { marketId: XAU, ticker: "XAU/USDC PERP", marketStatus: "active", isPerpetual: true, oracleType: "pythpro", oracleBase: "346", oracleQuote: "7", oracleScaleFactor: 0, quoteDenom: "usdc", quoteDecimals: 6, raw: {} };
    const onChain = chainOrders.filter((o) => o.subaccountId.toLowerCase() === SUB);
    const reader: InjectiveReader = {
      fetchMarkets: async () => [market], fetchOrderbooks: async () => [], fetchOraclePrices: async () => [], streamOraclePrices: () => {},
      fetchTrades: async () => [], fetchOrders: async () => onChain, fetchPositions: async () => [],
      streamTrades: () => {}, streamOrders: () => {}, streamPositions: () => {},
    };
    const idx = new LiveIndexer({ network: "testnet", reader, db: h.db, sql: h.sql, configuredArenaIds: [XAU], poller: null });
    await idx.refresh();
    await idx.refresh();
    const open = await h.sql<{ order_hash: string }[]>`SELECT order_hash FROM agent_orders WHERE agent_id = 7 AND cancelled_at IS NULL ORDER BY 1`;
    expect(open.map((r) => r.order_hash).sort()).toEqual(onChain.map((o) => o.orderHash.toLowerCase()).sort());
    await idx.stop();
  });

  it("writes full sdk Market records from the config catalog", async () => {
    const catalog = getMarkets("testnet");
    const r = await upsertMarketCatalog(h.db, [...catalog, { bogus: true }]);
    expect(r).toEqual({ written: catalog.length, invalid: 1 });
    if (catalog.length > 0) {
      const [row] = await h.sql<{ data: unknown }[]>`SELECT data FROM markets WHERE network = 'testnet' AND market_id = ${catalog[0]!.marketId.toLowerCase()}`;
      expect(Market.safeParse(row?.data).success).toBe(true);
    }
  });
});
