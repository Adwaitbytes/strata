/**
 * Baseline recorder (PRD 10.4): every `intervalMs` (5 s) samples the public orderbook of every
 * candidate market on one network and writes book_snapshots rows with provenance BASELINE.
 * Oracle price and publish timestamp come from the Indexer oracle price stream; markets with no
 * stream tick yet fall back to the polled oracle price with a null timestamp.
 */
import type { Db, Sql } from "@strata/db";
import { downsampleBaseline } from "../store/retention.js";
import type { Market, NetworkName, Provenance } from "@strata/sdk";
import type { InjectiveReader, OracleTick } from "../injective/reader.js";
import { errMsg, log } from "../lib/log.js";
import { resilientStream, type StreamHandle } from "../lib/resilient-stream.js";
import { selectBaselineMarkets, type CandidateMarket } from "../markets/select.js";
import { insertBookSnapshots, upsertHeartbeat, upsertMarkets } from "../store/writes.js";
import type { Liveness } from "../live/indexer.js";
import { buildSnapshotRow } from "./snapshot.js";

/** Indexer rejects StreamPricesByMarkets with more than 40 market IDs (observed live 2026-11-09). */
export const ORACLE_STREAM_MAX_MARKETS = 40;

export interface BaselineOptions {
  network: NetworkName;
  reader: InjectiveReader;
  db: Db;
  source: string;
  /** Arena-enabled markets from @strata/config; always recorded. */
  configured: readonly Pick<Market, "marketId" | "assetClass">[];
  /** Full Market records (all markets, not only arena) written into markets.data when present. */
  catalog?: readonly Market[];
  intervalMs?: number;
  refreshMarketsMs?: number;
  maxMarkets?: number;
  provenance?: Provenance;
  /** Full stored depth (maxStoredLevels) only on samples aligned to this period; top of book otherwise. */
  levelsEveryMs?: number;
  maxStoredLevels?: number;
  /** Raw SQL handle for retention; with `downsampleAfterHours` it thins old BASELINE rows hourly. */
  sql?: Sql;
  downsampleAfterHours?: number;
  /** Told about every tick outcome, so a pool that stops writing restarts the process. */
  liveness?: Liveness;
}

export class BaselineRecorder {
  private markets: CandidateMarket[] = [];
  private readonly oracle = new Map<string, OracleTick>();
  private streams: StreamHandle[] = [];
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private stopped = false;
  private lastRefresh = 0;
  private lastRetention = 0;
  private stats = { samples: 0, rows: 0, skippedOverlap: 0, errors: 0, lastError: null as string | null, lastLatencyMs: 0 };

  constructor(private readonly o: BaselineOptions) {}

  get marketCount(): number {
    return this.markets.length;
  }

  async refreshMarkets(): Promise<void> {
    const raw = await this.o.reader.fetchMarkets();
    const next = selectBaselineMarkets(this.o.network, raw, this.o.configured, this.o.maxMarkets);
    const changed = next.map((m) => m.marketId).join() !== this.markets.map((m) => m.marketId).join();
    this.markets = next;
    this.lastRefresh = Date.now();
    const catalog = new Map((this.o.catalog ?? []).map((m) => [m.marketId.toLowerCase(), m as unknown as Record<string, unknown>]));
    await upsertMarkets(this.o.db, next, this.o.source, new Date(), catalog);
    if (changed) {
      log("info", "baseline markets", { network: this.o.network, count: next.length, tickers: next.map((m) => m.ticker) });
      this.restartOracleStream();
    }
  }

  private restartOracleStream(): void {
    for (const s of this.streams) s.stop();
    const ids = this.markets.map((m) => m.marketId);
    this.streams = [];
    for (let i = 0; i < ids.length; i += ORACLE_STREAM_MAX_MARKETS) {
      const shard = ids.slice(i, i + ORACLE_STREAM_MAX_MARKETS);
      this.streams.push(
        resilientStream(`oracle:${this.o.network}:${i / ORACLE_STREAM_MAX_MARKETS}`, (h, signal) =>
          this.o.reader.streamOraclePrices(
            shard,
            (t) => {
              h.onData();
              this.oracle.set(t.marketId, t);
            },
            { onEnd: h.onEnd, onError: h.onError },
            signal,
          ),
        ),
      );
    }
  }

  private oracleStreamLastMessageAt(): number | null {
    const times = this.streams.map((s) => s.lastMessageAt()).filter((t): t is number => t !== null);
    return times.length > 0 ? Math.min(...times) : null;
  }

  /** One sampling pass. Returns rows inserted. */
  async sampleOnce(at: Date): Promise<number> {
    const started = Date.now();
    const missing = this.markets.filter((m) => !this.oracle.has(m.marketId));
    const [books, polled] = await Promise.all([
      this.o.reader.fetchOrderbooks(this.markets.map((m) => m.marketId)),
      missing.length > 0 ? this.o.reader.fetchOraclePrices(missing.map((m) => m.raw)).catch((e: unknown) => {
        log("warn", "oracle poll failed", { network: this.o.network, error: errMsg(e) });
        return [] as OracleTick[];
      }) : Promise.resolve([] as OracleTick[]),
    ]);
    const polledById = new Map(polled.map((p) => [p.marketId, p]));
    const byId = new Map(this.markets.map((m) => [m.marketId, m]));
    const levelsEvery = this.o.levelsEveryMs ?? 60_000;
    const maxStoredLevels = at.getTime() % levelsEvery === 0 ? (this.o.maxStoredLevels ?? 5) : 1;
    const rows = [];
    for (const b of books) {
      const market = byId.get(b.marketId);
      if (!market) continue;
      rows.push(
        buildSnapshotRow({
          network: this.o.network,
          provenance: this.o.provenance ?? "BASELINE",
          at,
          market,
          orderbook: b,
          oracle: this.oracle.get(b.marketId) ?? polledById.get(b.marketId),
          maxStoredLevels,
        }),
      );
    }
    const inserted = await insertBookSnapshots(this.o.db, rows);
    this.stats.samples += 1;
    this.stats.rows += inserted;
    this.stats.lastLatencyMs = Date.now() - started;
    return inserted;
  }

  /** One scheduled pass: sample, retention, heartbeat. Never throws; failures are logged and counted. */
  async tick(): Promise<void> {
    if (this.running) {
      this.stats.skippedOverlap += 1;
      return;
    }
    this.running = true;
    // Align sample timestamps to the interval grid so networks and markets share timestamps.
    const interval = this.o.intervalMs ?? 5_000;
    const at = new Date(Math.floor(Date.now() / interval) * interval);
    try {
      if (Date.now() - this.lastRefresh > (this.o.refreshMarketsMs ?? 600_000)) await this.refreshMarkets();
      const inserted = await this.sampleOnce(at);
      await this.maybeDownsample();
      await upsertHeartbeat(this.o.db, this.o.network, "baseline", new Date(), {
        markets: this.markets.length,
        lastSampleAt: at.toISOString(),
        lastInserted: inserted,
        oracleStreams: this.streams.length,
        oracleStreamOldestLastMessageAt: this.oracleStreamLastMessageAt(),
        dataLagMs: Date.now() - at.getTime(),
        ...this.stats,
      });
      this.o.liveness?.success();
    } catch (e) {
      this.o.liveness?.failure(e);
      this.stats.errors += 1;
      this.stats.lastError = errMsg(e);
      log("error", "baseline sample failed", { network: this.o.network, error: errMsg(e) });
    } finally {
      this.running = false;
    }
  }

  private async maybeDownsample(): Promise<void> {
    const { sql, downsampleAfterHours } = this.o;
    if (!sql || downsampleAfterHours === undefined || Date.now() - this.lastRetention < 3_600_000) return;
    this.lastRetention = Date.now();
    const removed = await downsampleBaseline(sql, this.o.network, downsampleAfterHours);
    log("info", "baseline downsampled", { network: this.o.network, removed, afterHours: downsampleAfterHours });
  }

  async start(): Promise<void> {
    await this.refreshMarkets();
    const interval = this.o.intervalMs ?? 5_000;
    const schedule = () => {
      if (this.stopped) return;
      const wait = interval - (Date.now() % interval);
      this.timer = setTimeout(() => {
        void this.tick();
        schedule();
      }, wait);
    };
    schedule();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    for (const s of this.streams) s.stop();
  }
}
