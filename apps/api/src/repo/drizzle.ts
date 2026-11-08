/**
 * Postgres implementation of Repository (Drizzle over postgres.js). All SQL is built by
 * Drizzle or its `sql` tagged template, so every value is a bound parameter (PRD 16.2).
 * Driver failures surface as DataUnavailableError; callers never see driver messages.
 */
import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { and, count, countDistinct, desc, eq, gte, isNotNull, isNull, max, min, avg, sql } from "drizzle-orm";
import { schema } from "@strata/db";
import type { NetworkName } from "@strata/sdk";
import { LiquiditySample, Provenance } from "@strata/sdk";
import { DataUnavailableError } from "../errors.js";
import type {
  BaselineStats,
  EventQuery,
  Heartbeat,
  KillCommandInput,
  KillInsertResult,
  OracleReading,
  Repository,
} from "./types.js";
import {
  Schemas,
  agentCandidate,
  bookCandidate,
  compact,
  epochCandidate,
  fillCandidate,
  guardCandidate,
  makeMapper,
  marketCandidate,
  quoteCandidate,
  scoreCandidate,
  tunerCandidate,
  type InvalidRowReporter,
} from "./mappers.js";

const {
  markets, agents, bookSnapshots, agentOrders, agentFills, oraclePrices, guardEvents, tunerEvents,
  epochs, scores, heartbeats, adminNonces, killCommands,
} = schema;

/** Latest-book lookups only scan this far back; an older book is not a current book. */
const LATEST_BOOK_LOOKBACK_MS = 24 * 3_600_000;
const QUOTE_LIMIT = 200;

export interface DrizzleRepoOptions {
  onInvalidRow: InvalidRowReporter;
}

export interface DbConnection {
  db: PostgresJsDatabase<typeof schema>;
  close: () => Promise<void>;
}

/**
 * Serverless-friendly pool: small, idle connections released quickly, and no prepared
 * statements so it also works behind Neon's PgBouncer pooler (transaction mode).
 */
export function connect(url: string, max = 5): DbConnection {
  const local = /@(localhost|127\.0\.0\.1)(:|\/)/.test(url) || /sslmode=disable/.test(url);
  const client = postgres(url, {
    max,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
    ssl: local ? false : "require",
    onnotice: () => {},
    connection: { application_name: "strata-api" },
  });
  return { db: drizzle(client, { schema }), close: () => client.end({ timeout: 5 }) };
}

const toDate = (msValue: number) => new Date(msValue);

export class DrizzleRepository implements Repository {
  private readonly m;

  constructor(private readonly db: PostgresJsDatabase<typeof schema>, opts: DrizzleRepoOptions) {
    const r = opts.onInvalidRow;
    this.m = {
      market: makeMapper("markets", Schemas.Market, r),
      agent: makeMapper("agents", Schemas.AgentProfile, r),
      book: makeMapper("book_snapshots", Schemas.BookSnapshot, r),
      quote: makeMapper("agent_orders", Schemas.Quote, r),
      fill: makeMapper("agent_fills", Schemas.Fill, r),
      guard: makeMapper("guard_events", Schemas.GuardEvent, r),
      tuner: makeMapper("tuner_events", Schemas.TunerEvent, r),
      score: makeMapper("scores", Schemas.EpochScore, r),
      epoch: makeMapper("epochs", Schemas.EpochAttestation, r),
      sample: makeMapper("book_snapshots(history)", LiquiditySample, r),
    };
  }

  private async run<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      throw new DataUnavailableError({ cause: err });
    }
  }

  ping(): Promise<void> {
    return this.run(async () => {
      await this.db.execute(sql`select 1`);
    });
  }

  listMarkets(network: NetworkName) {
    return this.run(async () => {
      const rows = await this.db.select().from(markets).where(eq(markets.network, network)).orderBy(markets.ticker);
      return compact(rows.map((r) => this.m.market(marketCandidate(r))));
    });
  }

  getMarket(network: NetworkName, marketId: string) {
    return this.run(async () => {
      const [r] = await this.db.select().from(markets).where(and(eq(markets.network, network), eq(markets.marketId, marketId))).limit(1);
      return r ? this.m.market(marketCandidate(r)) : null;
    });
  }

  latestBooks(network: NetworkName) {
    return this.run(async () => {
      const since = toDate(Date.now() - LATEST_BOOK_LOOKBACK_MS);
      const rows = await this.db
        .selectDistinctOn([bookSnapshots.marketId])
        .from(bookSnapshots)
        .where(and(eq(bookSnapshots.network, network), gte(bookSnapshots.at, since)))
        .orderBy(bookSnapshots.marketId, desc(bookSnapshots.at));
      return compact(rows.map((r) => this.m.book(bookCandidate(r))));
    });
  }

  latestBook(network: NetworkName, marketId: string) {
    return this.run(async () => {
      const since = toDate(Date.now() - LATEST_BOOK_LOOKBACK_MS);
      const [r] = await this.db
        .select()
        .from(bookSnapshots)
        .where(and(eq(bookSnapshots.network, network), eq(bookSnapshots.marketId, marketId), gte(bookSnapshots.at, since)))
        .orderBy(desc(bookSnapshots.at))
        .limit(1);
      return r ? this.m.book(bookCandidate(r)) : null;
    });
  }

  baselineStats(network: NetworkName): Promise<BaselineStats[]> {
    return this.run(async () => {
      const rows = await this.db
        .select({
          marketId: bookSnapshots.marketId,
          spreadBps: avg(bookSnapshots.spreadBps),
          depthUsd25: avg(bookSnapshots.depthUsd25),
          windowStart: min(bookSnapshots.at),
          windowEnd: max(bookSnapshots.at),
          samples: count(),
        })
        .from(bookSnapshots)
        .where(and(eq(bookSnapshots.network, network), eq(bookSnapshots.provenance, "BASELINE")))
        .groupBy(bookSnapshots.marketId);
      const out: BaselineStats[] = [];
      for (const r of rows) {
        if (!r.windowStart || !r.windowEnd || r.depthUsd25 === null) continue;
        out.push({
          marketId: r.marketId,
          spreadBps: r.spreadBps === null ? null : Number(r.spreadBps),
          depthUsd25: Number(r.depthUsd25),
          windowStart: r.windowStart.getTime(),
          windowEnd: r.windowEnd.getTime(),
          samples: r.samples,
        });
      }
      return out;
    });
  }

  liquidityHistory(network: NetworkName, marketId: string, sinceMs: number, bucketMs: number) {
    return this.run(async () => {
      const bucket = sql<Date>`date_bin(make_interval(secs => ${bucketMs / 1000}), ${bookSnapshots.at}, timestamptz '2000-01-01')`;
      const rows = await this.db
        .select({
          at: bucket.mapWith((v: string | Date) => new Date(v)),
          provenance: bookSnapshots.provenance,
          spreadBps: avg(bookSnapshots.spreadBps),
          depthUsd25: avg(bookSnapshots.depthUsd25),
          strataDepthUsd25: avg(bookSnapshots.strataDepthUsd25),
        })
        .from(bookSnapshots)
        .where(and(eq(bookSnapshots.network, network), eq(bookSnapshots.marketId, marketId), gte(bookSnapshots.at, toDate(sinceMs))))
        // Positional references: a bound interval parameter repeated in GROUP BY would not be
        // recognised by Postgres as the same expression as the one in the select list.
        .groupBy(sql`1`, sql`2`)
        .orderBy(sql`1`);
      return compact(
        rows.map((r) =>
          this.m.sample({
            at: r.at.getTime(),
            provenance: Provenance.parse(r.provenance),
            spreadBps: r.spreadBps === null ? null : Number(r.spreadBps),
            depthUsd25: Number(r.depthUsd25),
            strataDepthUsd25: Number(r.strataDepthUsd25),
          }),
        ),
      );
    });
  }

  latestOracle(network: NetworkName, marketId: string): Promise<OracleReading | null> {
    return this.run(async () => {
      const [r] = await this.db
        .select({ price: oraclePrices.price, oracleTs: oraclePrices.oracleTs })
        .from(oraclePrices)
        .where(and(eq(oraclePrices.network, network), eq(oraclePrices.marketId, marketId)))
        .orderBy(desc(oraclePrices.at))
        .limit(1);
      return r ? { price: r.price, timestamp: r.oracleTs.getTime() } : null;
    });
  }

  listAgents(network: NetworkName) {
    return this.run(async () => {
      const rows = await this.db.select().from(agents).where(eq(agents.network, network)).orderBy(agents.agentId);
      return compact(rows.map((r) => this.m.agent(agentCandidate(r))));
    });
  }

  getAgent(network: NetworkName, agentId: number) {
    return this.run(async () => {
      const [r] = await this.db.select().from(agents).where(and(eq(agents.network, network), eq(agents.agentId, agentId))).limit(1);
      return r ? this.m.agent(agentCandidate(r)) : null;
    });
  }

  liveQuotes(network: NetworkName, agentId: number, sinceMs: number) {
    return this.run(async () => {
      const rows = await this.db
        .select()
        .from(agentOrders)
        .where(and(eq(agentOrders.network, network), eq(agentOrders.agentId, agentId), isNull(agentOrders.cancelledAt), gte(agentOrders.postedAt, toDate(sinceMs))))
        .orderBy(desc(agentOrders.postedAt))
        .limit(QUOTE_LIMIT);
      return compact(rows.map((r) => this.m.quote(quoteCandidate(r))));
    });
  }

  quotingAgentCount(network: NetworkName, sinceMs: number) {
    return this.run(async () => {
      const [r] = await this.db
        .select({ n: countDistinct(agentOrders.agentId) })
        .from(agentOrders)
        .where(and(eq(agentOrders.network, network), isNull(agentOrders.cancelledAt), gte(agentOrders.postedAt, toDate(sinceMs))));
      return r?.n ?? 0;
    });
  }

  recentFills(network: NetworkName, agentId: number, limit: number) {
    return this.run(async () => {
      const rows = await this.db
        .select()
        .from(agentFills)
        .where(and(eq(agentFills.network, network), eq(agentFills.agentId, agentId)))
        .orderBy(desc(agentFills.executedAt))
        .limit(limit);
      return compact(rows.map((r) => this.m.fill(fillCandidate(r))));
    });
  }

  agentScores(network: NetworkName, agentId: number, limit: number) {
    return this.run(async () => {
      const rows = await this.db
        .select()
        .from(scores)
        .where(and(eq(scores.network, network), eq(scores.agentId, agentId)))
        .orderBy(desc(scores.season), desc(scores.epoch))
        .limit(limit);
      return compact(rows.map((r) => this.m.score(scoreCandidate(r))));
    });
  }

  guardEvents(network: NetworkName, q: EventQuery) {
    return this.run(async () => {
      const rows = await this.db
        .select()
        .from(guardEvents)
        .where(and(
          eq(guardEvents.network, network),
          q.agentId === undefined ? undefined : eq(guardEvents.agentId, q.agentId),
          q.sinceMs === undefined ? undefined : gte(guardEvents.at, toDate(q.sinceMs)),
        ))
        .orderBy(desc(guardEvents.at))
        .limit(q.limit);
      return compact(rows.map((r) => this.m.guard(guardCandidate(r))));
    });
  }

  tunerEvents(network: NetworkName, q: EventQuery) {
    return this.run(async () => {
      const rows = await this.db
        .select()
        .from(tunerEvents)
        .where(and(
          eq(tunerEvents.network, network),
          q.agentId === undefined ? undefined : eq(tunerEvents.agentId, q.agentId),
          q.sinceMs === undefined ? undefined : gte(tunerEvents.at, toDate(q.sinceMs)),
        ))
        .orderBy(desc(tunerEvents.at))
        .limit(q.limit);
      return compact(rows.map((r) => this.m.tuner(tunerCandidate(r))));
    });
  }

  heartbeats(network: NetworkName): Promise<Heartbeat[]> {
    return this.run(async () => {
      const rows = await this.db.select().from(heartbeats).where(eq(heartbeats.network, network)).orderBy(heartbeats.service);
      return rows.map((r) => ({
        service: r.service,
        at: r.at.getTime(),
        detail: typeof r.detail === "object" && r.detail !== null && !Array.isArray(r.detail) ? (r.detail as Record<string, unknown>) : {},
      }));
    });
  }

  latestSeason(network: NetworkName) {
    return this.run(async () => {
      const [r] = await this.db.select({ s: max(scores.season) }).from(scores).where(eq(scores.network, network));
      return r?.s ?? null;
    });
  }

  scoredEpochs(network: NetworkName, season: number, limit: number) {
    return this.run(async () => {
      const rows = await this.db
        .selectDistinct({ epoch: scores.epoch })
        .from(scores)
        .where(and(eq(scores.network, network), eq(scores.season, season)))
        .orderBy(desc(scores.epoch))
        .limit(limit);
      return rows.map((r) => r.epoch);
    });
  }

  epochScores(network: NetworkName, season: number, epoch: number) {
    return this.run(async () => {
      const rows = await this.db
        .select()
        .from(scores)
        .where(and(eq(scores.network, network), eq(scores.season, season), eq(scores.epoch, epoch)))
        .orderBy(desc(scores.score), scores.agentId);
      return compact(rows.map((r) => this.m.score(scoreCandidate(r))));
    });
  }

  listEpochs(network: NetworkName, limit: number) {
    return this.run(async () => {
      const rows = await this.db.select().from(epochs).where(eq(epochs.network, network)).orderBy(desc(epochs.season), desc(epochs.epoch)).limit(limit);
      return compact(rows.map((r) => this.m.epoch(epochCandidate(r))));
    });
  }

  getEpoch(network: NetworkName, season: number, epoch: number) {
    return this.run(async () => {
      const [r] = await this.db
        .select()
        .from(epochs)
        .where(and(eq(epochs.network, network), eq(epochs.season, season), eq(epochs.epoch, epoch)))
        .limit(1);
      return r ? this.m.epoch(epochCandidate(r)) : null;
    });
  }

  latestPostedEpoch(network: NetworkName) {
    return this.run(async () => {
      const [r] = await this.db
        .select()
        .from(epochs)
        .where(and(eq(epochs.network, network), isNotNull(epochs.postedAt)))
        .orderBy(desc(epochs.postedAt))
        .limit(1);
      return r ? this.m.epoch(epochCandidate(r)) : null;
    });
  }

  insertKillCommand(cmd: KillCommandInput): Promise<KillInsertResult> {
    return this.run(() =>
      this.db.transaction(async (tx) => {
        const claimed = await tx
          .insert(adminNonces)
          .values({ nonce: cmd.nonce, usedAt: toDate(cmd.requestedAt) })
          .onConflictDoNothing()
          .returning({ nonce: adminNonces.nonce });
        if (claimed.length === 0) return "nonce_reused" as const;
        await tx.insert(killCommands).values({
          id: cmd.id,
          network: cmd.network,
          targetAgentId: cmd.targetAgentId,
          closePositions: cmd.closePositions,
          signer: cmd.signer,
          nonce: cmd.nonce,
          requestedAt: toDate(cmd.requestedAt),
          signatureExpiresAt: toDate(cmd.signatureExpiresAt),
        });
        // Delivered on commit; agents that LISTEN react immediately, the rest poll the table.
        await tx.execute(sql`select pg_notify('strata_kill', ${cmd.id})`);
        return "inserted" as const;
      }),
    );
  }
}
