/**
 * Live indexer (PRD 11.1) for one network:
 *  - arena market set = latest MarketSet events (arena poller) + @strata/config markets with
 *    arenaEnabled + optional extra IDs, always intersected with the live Indexer market list;
 *  - Indexer streams: trades (arena markets), orders and positions (per agent subaccount),
 *    oracle prices (arena markets), each kept alive by resilientStream;
 *  - 5 s book snapshots with STRATA depth from open agent orders (provenance LIVE / TESTNET);
 *  - Blockscout arena poller; heartbeat row "indexer" with stream lag and data lag for /status.
 * All writes are idempotent upserts, so overlapping REST reconciliation and streams are safe.
 */
import type { Db, Sql } from "@strata/db";
import type { NetworkName } from "@strata/sdk";
import type { ArenaPoller, PollResult } from "../arena/poller.js";
import { arenaMarketIds } from "../arena/project.js";
import type { InjectiveReader, OracleTick, RawDerivativeMarket } from "../injective/reader.js";
import { errMsg, log } from "../lib/log.js";
import { resilientStream, type StreamHandle } from "../lib/resilient-stream.js";
import { computeBookMetrics } from "../book/metrics.js";
import { insertBookSnapshots, upsertHeartbeat } from "../store/writes.js";
import { insertOraclePrices, insertPositions, insertTrades, upsertAgentOrders, type OracleRow } from "../store/live.js";
import { loadAgents, type AgentRef } from "./agents.js";
import { liveProvenance, mapOrder, mapPosition, mapTrade, strataBookMaps, type FillRow, type OrderRow, type PositionRow, type TradeRow } from "./mappers.js";
import type { IndexerOrder } from "./records.js";
import { SESSION_UNKNOWN } from "../baseline/snapshot.js";

/** Same per-request cap the Indexer enforces on market-filtered streams (oracle: 40, observed live). */
const STREAM_SHARD = 40;

export interface LiveIndexerOptions {
  network: NetworkName;
  reader: InjectiveReader;
  db: Db;
  sql: Sql;
  configuredArenaIds: readonly string[];
  extraMarketIds?: readonly string[];
  poller: ArenaPoller | null;
  snapshotMs?: number;
  refreshMs?: number;
  pollMs?: number;
  /** Take book snapshots even before any agent enrolls (tests, local runs). */
  snapshotWithoutAgents?: boolean;
}

export class LiveIndexer {
  private markets = new Map<string, RawDerivativeMarket>();
  private agents: AgentRef[] = [];
  private agentBySub = new Map<string, number>();
  private openOrders = new Map<string, IndexerOrder>();
  private oracle = new Map<string, OracleTick>();
  private streams = new Map<string, StreamHandle>();
  private timers: NodeJS.Timeout[] = [];
  private buf = { trades: [] as TradeRow[], fills: [] as FillRow[], orders: [] as OrderRow[], positions: [] as PositionRow[], oracle: [] as OracleRow[] };
  private stats = {
    trades: 0,
    fills: 0,
    snapshots: 0,
    errors: 0,
    lastError: null as string | null,
    lastSnapshotAt: null as number | null,
    lastTradeAt: null as number | null,
    lastPoll: null as (PollResult & { at: number }) | null,
  };
  private busy = new Set<string>();

  constructor(private readonly o: LiveIndexerOptions) {}

  private guard(name: string, fn: () => Promise<void>): () => void {
    return () => {
      if (this.busy.has(name)) return;
      this.busy.add(name);
      fn()
        .catch((e: unknown) => {
          this.stats.errors += 1;
          this.stats.lastError = `${name}: ${errMsg(e)}`;
          log("error", "indexer task failed", { network: this.o.network, task: name, error: errMsg(e) });
        })
        .finally(() => this.busy.delete(name));
    };
  }

  async refresh(): Promise<void> {
    const live = await this.o.reader.fetchMarkets();
    const byId = new Map(live.map((m) => [m.marketId.toLowerCase(), m]));
    const wanted = new Set([...(await arenaMarketIds(this.o.sql, this.o.network)), ...this.o.configuredArenaIds, ...(this.o.extraMarketIds ?? [])].map((x) => x.toLowerCase()));
    const next = new Map<string, RawDerivativeMarket>();
    for (const id of wanted) {
      const m = byId.get(id);
      if (m) next.set(id, m);
      else log("warn", "arena market not in live Indexer list, skipped", { network: this.o.network, marketId: id });
    }
    const agents = await loadAgents(this.o.sql, this.o.network);
    const marketsChanged = [...next.keys()].sort().join() !== [...this.markets.keys()].sort().join();
    const agentsChanged = agents.map((a) => a.subaccountId).join() !== this.agents.map((a) => a.subaccountId).join();
    this.markets = next;
    this.agents = agents;
    this.agentBySub = new Map(agents.map((a) => [a.subaccountId, a.agentId]));
    if (marketsChanged || agentsChanged) {
      log("info", "indexer scope", { network: this.o.network, markets: [...next.values()].map((m) => m.ticker), agents: agents.length });
      this.restartStreams();
    }
    await this.reconcileAgents();
  }

  /** REST reconciliation: rebuilds open orders and samples positions for every agent. */
  private async reconcileAgents(): Promise<void> {
    const ids = [...this.markets.keys()];
    if (ids.length === 0 || this.agents.length === 0) {
      this.openOrders.clear();
      return;
    }
    const fresh = new Map<string, IndexerOrder>();
    const now = new Date();
    for (const a of this.agents) {
      const [orders, positions] = await Promise.all([
        this.o.reader.fetchOrders({ subaccountId: a.subaccountId, marketIds: ids }),
        this.o.reader.fetchPositions({ subaccountId: a.subaccountId, marketIds: ids }),
      ]);
      for (const ord of orders) {
        fresh.set(ord.orderHash.toLowerCase(), ord);
        this.queueOrder(ord, a.agentId);
      }
      for (const p of positions) {
        const m = this.markets.get(p.marketId.toLowerCase());
        if (m) this.buf.positions.push(mapPosition(p, this.o.network, m.quoteDecimals, a.agentId, now));
      }
    }
    this.openOrders = fresh;
  }

  private queueOrder(ord: IndexerOrder, agentId: number): void {
    const m = this.markets.get(ord.marketId.toLowerCase());
    if (!m) return;
    this.buf.orders.push(mapOrder(ord, this.o.network, m.quoteDecimals, agentId));
  }

  private startStream(key: string, start: Parameters<typeof resilientStream>[1]): void {
    this.streams.set(key, resilientStream(`${this.o.network}:${key}`, start, { stallMs: 120_000 }));
  }

  private restartStreams(): void {
    for (const s of this.streams.values()) s.stop();
    this.streams.clear();
    const ids = [...this.markets.keys()];
    for (let i = 0; i < ids.length; i += STREAM_SHARD) {
      const shard = ids.slice(i, i + STREAM_SHARD);
      const n = i / STREAM_SHARD;
      this.startStream(`trades:${n}`, (h, signal) =>
        this.o.reader.streamTrades(
          shard,
          (t) => {
            h.onData();
            const m = this.markets.get(t.marketId.toLowerCase());
            if (!m) return;
            const { trade, fill } = mapTrade(t, this.o.network, m.quoteDecimals, this.agentBySub);
            this.buf.trades.push(trade);
            if (fill) this.buf.fills.push(fill);
            this.stats.lastTradeAt = t.executedAt;
          },
          h,
          signal,
        ),
      );
      this.startStream(`oracle:${n}`, (h, signal) =>
        this.o.reader.streamOraclePrices(
          shard,
          (t) => {
            h.onData();
            this.oracle.set(t.marketId, t);
            const m = this.markets.get(t.marketId.toLowerCase());
            if (m && t.timestampMs !== null) {
              this.buf.oracle.push({ network: this.o.network, marketId: t.marketId.toLowerCase(), source: m.oracleType, at: new Date(t.timestampMs), price: t.price, oracleTs: new Date(t.timestampMs) });
            }
          },
          h,
          signal,
        ),
      );
    }
    for (const a of this.agents) {
      this.startStream(`orders:${a.agentId}`, (h, signal) =>
        this.o.reader.streamOrders(
          a.subaccountId,
          (ord) => {
            h.onData();
            const key = ord.orderHash.toLowerCase();
            if (ord.state === "booked" || ord.state === "partial_filled") this.openOrders.set(key, ord);
            else this.openOrders.delete(key);
            this.queueOrder(ord, a.agentId);
          },
          h,
          signal,
        ),
      );
      this.startStream(`positions:${a.agentId}`, (h, signal) =>
        this.o.reader.streamPositions(
          a.subaccountId,
          (p) => {
            h.onData();
            const m = this.markets.get(p.marketId.toLowerCase());
            if (m) this.buf.positions.push(mapPosition(p, this.o.network, m.quoteDecimals, a.agentId, new Date(p.updatedAt ?? Date.now())));
          },
          h,
          signal,
        ),
      );
    }
  }

  async flush(): Promise<void> {
    const b = this.buf;
    this.buf = { trades: [], fills: [], orders: [], positions: [], oracle: [] };
    const r = await insertTrades(this.o.db, b.trades, b.fills);
    this.stats.trades += r.trades;
    this.stats.fills += r.fills;
    await upsertAgentOrders(this.o.db, dedupeOrders(b.orders));
    await insertPositions(this.o.db, b.positions);
    await insertOraclePrices(this.o.db, b.oracle);
  }

  /**
   * With no enrolled agents a LIVE/TESTNET snapshot would equal the BASELINE recorder's row for the
   * same market, so snapshots start with the first agent (saves Neon free-tier storage).
   */
  get snapshotsPaused(): boolean {
    return this.agents.length === 0 && !this.o.snapshotWithoutAgents;
  }

  async snapshot(at: Date): Promise<number> {
    const ids = [...this.markets.keys()];
    if (ids.length === 0 || this.snapshotsPaused) return 0;
    const books = await this.o.reader.fetchOrderbooks(ids);
    const rows = [];
    for (const b of books) {
      const m = this.markets.get(b.marketId.toLowerCase());
      if (!m) continue;
      const strata = strataBookMaps(this.openOrders.values(), m.marketId, m.quoteDecimals);
      const metrics = computeBookMetrics(b, m.quoteDecimals, { strataBids: strata.bids, strataAsks: strata.asks, maxStoredLevels: 5 });
      const oracle = this.oracle.get(b.marketId);
      rows.push({
        network: this.o.network,
        marketId: m.marketId.toLowerCase(),
        at,
        provenance: liveProvenance(this.o.network),
        mid: metrics.mid,
        spreadBps: metrics.spreadBps,
        depthUsd25: metrics.depthUsd25,
        strataDepthUsd25: metrics.strataDepthUsd25,
        bids: metrics.bids,
        asks: metrics.asks,
        oraclePrice: oracle?.price ?? null,
        oracleTs: oracle?.timestampMs != null ? new Date(oracle.timestampMs) : null,
        sessionState: SESSION_UNKNOWN,
      });
    }
    const n = await insertBookSnapshots(this.o.db, rows);
    this.stats.snapshots += n;
    this.stats.lastSnapshotAt = at.getTime();
    return n;
  }

  heartbeatDetail(now = Date.now()): Record<string, unknown> {
    const streams: Record<string, number | null> = {};
    for (const [k, s] of this.streams) {
      const t = s.lastMessageAt();
      streams[k] = t === null ? null : now - t;
    }
    return {
      arenaMarkets: this.markets.size,
      agents: this.agents.length,
      openAgentOrders: this.openOrders.size,
      snapshotsPaused: this.snapshotsPaused,
      streamLagMs: streams,
      dataLagMs: this.stats.lastSnapshotAt === null ? null : now - this.stats.lastSnapshotAt,
      tradeLagMs: this.stats.lastTradeAt === null ? null : now - this.stats.lastTradeAt,
      ...this.stats,
    };
  }

  async start(): Promise<void> {
    await this.refresh();
    const snapshotMs = this.o.snapshotMs ?? 5_000;
    const every = (ms: number, fn: () => void) => {
      const t = setInterval(fn, ms);
      this.timers.push(t);
    };
    every(this.o.refreshMs ?? 30_000, this.guard("refresh", () => this.refresh()));
    every(2_000, this.guard("flush", () => this.flush()));
    every(snapshotMs, this.guard("snapshot", async () => void (await this.snapshot(new Date(Math.floor(Date.now() / snapshotMs) * snapshotMs)))));
    every(10_000, this.guard("heartbeat", () => upsertHeartbeat(this.o.db, this.o.network, "indexer", new Date(), this.heartbeatDetail())));
    if (this.o.poller) {
      const poller = this.o.poller;
      const poll = this.guard("arena-poll", async () => {
        const r = await poller.pollOnce();
        this.stats.lastPoll = { ...r, at: Date.now() };
        if (r.inserted > 0) await this.refresh();
      });
      poll();
      every(this.o.pollMs ?? 15_000, poll);
    }
  }

  async stop(): Promise<void> {
    for (const t of this.timers) clearInterval(t);
    for (const s of this.streams.values()) s.stop();
    await this.flush();
  }
}

/** Keeps the latest state per order key so one batch never upserts the same row twice. */
export function dedupeOrders(rows: readonly OrderRow[]): OrderRow[] {
  const m = new Map<string, OrderRow>();
  for (const r of rows) {
    const k = `${r.orderHash}|${r.postedAt.getTime()}`;
    const prev = m.get(k);
    m.set(k, prev && prev.cancelledAt && !r.cancelledAt ? prev : r);
  }
  return [...m.values()];
}
