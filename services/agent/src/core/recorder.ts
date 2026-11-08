/**
 * Event recorder (PRD 9.2 step 6). The quoting cycle pushes quotes, cancels, fills, guard and
 * tuner events into an in-memory buffer and returns immediately; a background flush writes them
 * to Postgres through @strata/db (Drizzle). A slow or down database never blocks a cycle: the
 * buffer is bounded and drops the oldest events (counted in `stats.dropped`) when full.
 */
import { and, eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { agentFills, agentOrders, guardEvents, tunerEvents } from "@strata/db";
import { Fill, GuardEvent, NetworkName, Quote, TunerEvent } from "@strata/sdk";
import { z } from "zod";

export const CancelRecord = z.object({ network: NetworkName, orderHash: z.string().min(1), cancelledAt: z.number().int().nonnegative() });
export type CancelRecord = z.infer<typeof CancelRecord>;

export type RecordedEvent =
  | { readonly kind: "quote"; readonly value: Quote }
  | { readonly kind: "cancel"; readonly value: CancelRecord }
  | { readonly kind: "fill"; readonly value: Fill }
  | { readonly kind: "guard"; readonly value: GuardEvent }
  | { readonly kind: "tuner"; readonly value: TunerEvent };

export interface EventSink {
  quote(q: Quote): void;
  cancel(c: CancelRecord): void;
  fill(f: Fill): void;
  guard(e: GuardEvent): void;
  tuner(e: TunerEvent): void;
}

export interface RecordWriter {
  write(events: readonly RecordedEvent[]): Promise<void>;
}

export interface RecorderStats {
  buffered: number;
  written: number;
  dropped: number;
  invalid: number;
  failedWrites: number;
}

export interface BufferedRecorderOptions {
  readonly writer: RecordWriter;
  readonly maxBuffer?: number;
  readonly batchSize?: number;
  readonly flushIntervalMs?: number;
  readonly onError?: (err: unknown) => void;
}

const SCHEMAS = { quote: Quote, cancel: CancelRecord, fill: Fill, guard: GuardEvent, tuner: TunerEvent } as const;

export class BufferedRecorder implements EventSink {
  readonly #writer: RecordWriter;
  readonly #maxBuffer: number;
  readonly #batchSize: number;
  readonly #flushIntervalMs: number;
  readonly #onError: (err: unknown) => void;
  #buffer: RecordedEvent[] = [];
  #timer: ReturnType<typeof setInterval> | null = null;
  #flushing: Promise<void> | null = null;
  readonly #stats = { written: 0, dropped: 0, invalid: 0, failedWrites: 0 };

  constructor(opts: BufferedRecorderOptions) {
    this.#writer = opts.writer;
    this.#maxBuffer = opts.maxBuffer ?? 50_000;
    this.#batchSize = opts.batchSize ?? 500;
    this.#flushIntervalMs = opts.flushIntervalMs ?? 1_000;
    this.#onError = opts.onError ?? (() => undefined);
  }

  get stats(): RecorderStats {
    return { buffered: this.#buffer.length, ...this.#stats };
  }

  quote(q: Quote): void {
    this.#push({ kind: "quote", value: q });
  }
  cancel(c: CancelRecord): void {
    this.#push({ kind: "cancel", value: c });
  }
  fill(f: Fill): void {
    this.#push({ kind: "fill", value: f });
  }
  guard(e: GuardEvent): void {
    this.#push({ kind: "guard", value: e });
  }
  tuner(e: TunerEvent): void {
    this.#push({ kind: "tuner", value: e });
  }

  start(): void {
    if (this.#timer !== null) return;
    this.#timer = setInterval(() => void this.flush(), this.#flushIntervalMs);
    this.#timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = null;
    await this.flush();
  }

  /** Writes everything buffered. Concurrent calls share one in-flight flush. */
  flush(): Promise<void> {
    if (this.#flushing === null) {
      this.#flushing = this.#drain().finally(() => {
        this.#flushing = null;
      });
    }
    return this.#flushing;
  }

  async #drain(): Promise<void> {
    while (this.#buffer.length > 0) {
      const batch = this.#buffer.slice(0, this.#batchSize);
      try {
        await this.#writer.write(batch);
      } catch (err) {
        this.#stats.failedWrites++;
        this.#onError(err);
        return;
      }
      this.#buffer.splice(0, batch.length);
      this.#stats.written += batch.length;
    }
  }

  #push(event: RecordedEvent): void {
    if (!SCHEMAS[event.kind].safeParse(event.value).success) {
      this.#stats.invalid++;
      return;
    }
    this.#buffer.push(event);
    if (this.#buffer.length > this.#maxBuffer) {
      this.#buffer.splice(0, this.#buffer.length - this.#maxBuffer);
      this.#stats.dropped++;
    }
  }
}

/* ------------------------------ Postgres (Drizzle) ------------------------------ */

export function toOrderRow(q: Quote): typeof agentOrders.$inferInsert {
  return {
    network: q.network,
    agentId: q.agentId,
    marketId: q.marketId,
    orderHash: q.orderHash,
    side: q.side,
    price: q.price,
    quantity: q.quantity,
    level: q.level,
    postedAt: new Date(q.postedAt),
    cancelledAt: q.cancelledAt === null ? null : new Date(q.cancelledAt),
    provenance: q.provenance,
  };
}

export function toFillRow(f: Fill): typeof agentFills.$inferInsert {
  return {
    network: f.network,
    agentId: f.agentId,
    marketId: f.marketId,
    orderHash: f.orderHash,
    tradeId: f.tradeId,
    txHash: f.txHash,
    eventIndex: f.eventIndex,
    side: f.side,
    price: f.price,
    quantity: f.quantity,
    feeUsd: f.feeUsd,
    isMaker: f.isMaker,
    counterpartySubaccountId: f.counterpartySubaccountId,
    executedAt: new Date(f.executedAt),
    provenance: f.provenance,
  };
}

export function toGuardRow(e: GuardEvent): typeof guardEvents.$inferInsert {
  return {
    id: e.id,
    network: e.network,
    provenance: e.provenance,
    agentId: e.agentId,
    marketId: e.marketId,
    guard: e.guard,
    action: e.action,
    reason: e.reason,
    detail: e.detail,
    observed: e.observed,
    at: new Date(e.at),
  };
}

export function toTunerRow(e: TunerEvent): typeof tunerEvents.$inferInsert {
  return { id: e.id, network: e.network, agentId: e.agentId, marketId: e.marketId, mode: e.mode, model: e.model, payload: e, at: new Date(e.at) };
}

// The schema generic is irrelevant here: the writer only uses insert/update on imported tables.
type AnyPgJsDb = PostgresJsDatabase<Record<string, never>>;

/**
 * Idempotent writes: inserts ignore duplicates so a retried batch never double-counts.
 * `orders: false` leaves agent_orders to the indexer (services/indexer writes every order with its
 * chain createdAt); writing them here too would create a second row per order hash.
 */
export class DrizzleWriter implements RecordWriter {
  readonly #db: AnyPgJsDb;
  readonly #orders: boolean;

  constructor(db: AnyPgJsDb, opts: { orders: boolean } = { orders: true }) {
    this.#db = db;
    this.#orders = opts.orders;
  }

  async write(events: readonly RecordedEvent[]): Promise<void> {
    const orders = this.#orders ? events.flatMap((e) => (e.kind === "quote" ? [toOrderRow(e.value)] : [])) : [];
    const fills = events.flatMap((e) => (e.kind === "fill" ? [toFillRow(e.value)] : []));
    const guards = events.flatMap((e) => (e.kind === "guard" ? [toGuardRow(e.value)] : []));
    const tuners = events.flatMap((e) => (e.kind === "tuner" ? [toTunerRow(e.value)] : []));
    const cancels = this.#orders ? events.flatMap((e) => (e.kind === "cancel" ? [e.value] : [])) : [];
    await this.#db.transaction(async (tx) => {
      if (orders.length) await tx.insert(agentOrders).values(orders).onConflictDoNothing();
      if (fills.length) await tx.insert(agentFills).values(fills).onConflictDoNothing();
      if (guards.length) await tx.insert(guardEvents).values(guards).onConflictDoNothing();
      if (tuners.length) await tx.insert(tunerEvents).values(tuners).onConflictDoNothing();
      for (const c of cancels) {
        await tx
          .update(agentOrders)
          .set({ cancelledAt: new Date(c.cancelledAt) })
          .where(and(eq(agentOrders.network, c.network), eq(agentOrders.orderHash, c.orderHash)));
      }
    });
  }
}
