import { describe, expect, it, vi } from "vitest";
import type { Fill, GuardEvent, Quote, TunerEvent } from "@strata/sdk";
import { getTableName } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { BufferedRecorder, DrizzleWriter, toFillRow, toGuardRow, toOrderRow, toTunerRow, type RecordedEvent, type RecordWriter } from "./recorder.js";

const M = `0x${"a".repeat(64)}`;
const quote = (orderHash: string): Quote => ({
  network: "testnet",
  provenance: "TESTNET",
  agentId: 1,
  marketId: M,
  orderHash,
  side: "buy",
  price: "99.9",
  quantity: "0.25",
  level: 0,
  postedAt: 1_000,
  cancelledAt: null,
});
const fill: Fill = {
  network: "testnet",
  provenance: "TESTNET",
  agentId: 1,
  marketId: M,
  orderHash: "h1",
  tradeId: "t1",
  txHash: "0xabc",
  eventIndex: 2,
  side: "sell",
  price: "100.1",
  quantity: "1",
  feeUsd: 0.01,
  isMaker: true,
  counterpartySubaccountId: null,
  executedAt: 2_000,
};
const guard: GuardEvent = {
  network: "testnet",
  provenance: "TESTNET",
  id: "g1",
  agentId: 1,
  marketId: M,
  guard: "oracle",
  action: "halt",
  reason: "oracle_stale",
  detail: "stale",
  observed: { oracleAgeSec: 41 },
  at: 3_000,
};
const params = { gamma: 0.1, minHalfSpreadBps: 10, levels: 3, sizeMultiplier: 1, offHoursQuoting: false };
const tuner: TunerEvent = {
  network: "testnet",
  id: "t1",
  agentId: 1,
  marketId: M,
  mode: "shadow",
  model: "claude-opus-5-5",
  before: params,
  suggested: params,
  applied: null,
  clamped: [],
  rationale: "Fills are balanced.",
  rejected: false,
  rejectReason: null,
  at: 4_000,
};

const tableName = (t: unknown): string => getTableName(t as PgTable);

class MemoryWriter implements RecordWriter {
  batches: RecordedEvent[][] = [];
  failNext = 0;
  async write(events: readonly RecordedEvent[]): Promise<void> {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error("db down");
    }
    this.batches.push([...events]);
  }
  get all(): RecordedEvent[] {
    return this.batches.flat();
  }
}

describe("BufferedRecorder", () => {
  it("buffers events without blocking and writes them on flush", async () => {
    const w = new MemoryWriter();
    const r = new BufferedRecorder({ writer: w });
    r.quote(quote("h1"));
    r.cancel({ network: "testnet", orderHash: "h1", cancelledAt: 1_500 });
    r.fill(fill);
    r.guard(guard);
    r.tuner(tuner);
    expect(w.all).toHaveLength(0);
    await r.flush();
    expect(w.all.map((e) => e.kind)).toEqual(["quote", "cancel", "fill", "guard", "tuner"]);
    expect(r.stats).toMatchObject({ buffered: 0, written: 5, dropped: 0, invalid: 0 });
  });

  it("rejects schema-invalid events at the boundary", async () => {
    const w = new MemoryWriter();
    const r = new BufferedRecorder({ writer: w });
    r.quote({ ...quote("h1"), price: "not-a-number" });
    await r.flush();
    expect(w.all).toHaveLength(0);
    expect(r.stats.invalid).toBe(1);
  });

  it("keeps events after a failed write and retries them", async () => {
    const w = new MemoryWriter();
    const onError = vi.fn();
    const r = new BufferedRecorder({ writer: w, onError });
    r.quote(quote("h1"));
    w.failNext = 1;
    await r.flush();
    expect(onError).toHaveBeenCalledOnce();
    expect(r.stats).toMatchObject({ buffered: 1, failedWrites: 1 });
    await r.flush();
    expect(w.all).toHaveLength(1);
  });

  it("drops the oldest events when the buffer is full", async () => {
    const w = new MemoryWriter();
    const r = new BufferedRecorder({ writer: w, maxBuffer: 2 });
    r.quote(quote("h1"));
    r.quote(quote("h2"));
    r.quote(quote("h3"));
    await r.flush();
    expect(w.all.map((e) => (e.kind === "quote" ? e.value.orderHash : ""))).toEqual(["h2", "h3"]);
    expect(r.stats.dropped).toBe(1);
  });

  it("flushes on an interval and on stop, and never runs two writes at once", async () => {
    vi.useFakeTimers();
    try {
      let inFlight = 0;
      let maxInFlight = 0;
      const writer: RecordWriter = {
        write: async () => {
          inFlight++;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise((res) => setTimeout(res, 50));
          inFlight--;
        },
      };
      const r = new BufferedRecorder({ writer, flushIntervalMs: 10, batchSize: 1 });
      r.start();
      r.quote(quote("h1"));
      r.quote(quote("h2"));
      await vi.advanceTimersByTimeAsync(200);
      expect(r.stats.written).toBe(2);
      expect(maxInFlight).toBe(1);
      r.quote(quote("h3"));
      const stopping = r.stop();
      await vi.advanceTimersByTimeAsync(100);
      await stopping;
      expect(r.stats.written).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("DrizzleWriter order ownership", () => {
  it("skips quote and cancel rows when the indexer owns agent_orders", async () => {
    const calls: string[] = [];
    const tx = {
      insert: (t: unknown) => ({ values: () => ({ onConflictDoNothing: async () => void calls.push(`insert:${tableName(t)}`) }) }),
      update: () => ({ set: () => ({ where: async () => void calls.push("update") }) }),
    };
    const db = { transaction: async (fn: (t: typeof tx) => Promise<void>) => fn(tx) };
    const w = new DrizzleWriter(db as unknown as ConstructorParameters<typeof DrizzleWriter>[0], { orders: false });
    await w.write([
      { kind: "quote", value: quote("h1") },
      { kind: "cancel", value: { network: "testnet", orderHash: "h1", cancelledAt: 1 } },
      { kind: "guard", value: guard },
    ]);
    expect(calls).toEqual(["insert:guard_events"]);
  });
});

describe("DrizzleWriter fill ownership", () => {
  it("skips fill rows when the indexer owns agent_fills, keeps guard and tuner rows", async () => {
    const calls: string[] = [];
    const tx = {
      insert: (t: unknown) => ({ values: () => ({ onConflictDoNothing: async () => void calls.push(`insert:${tableName(t)}`) }) }),
      update: () => ({ set: () => ({ where: async () => void calls.push("update") }) }),
    };
    const db = { transaction: async (fn: (t: typeof tx) => Promise<void>) => fn(tx) };
    const w = new DrizzleWriter(db as unknown as ConstructorParameters<typeof DrizzleWriter>[0], { orders: false, fills: false });
    await w.write([{ kind: "fill", value: fill }, { kind: "guard", value: guard }, { kind: "tuner", value: tuner }]);
    expect(calls).toEqual(["insert:guard_events", "insert:tuner_events"]);
  });

  it("still writes fills by default (simulator runs)", async () => {
    const calls: string[] = [];
    const tx = { insert: (t: unknown) => ({ values: () => ({ onConflictDoNothing: async () => void calls.push(`insert:${tableName(t)}`) }) }) };
    const db = { transaction: async (fn: (t: typeof tx) => Promise<void>) => fn(tx) };
    const w = new DrizzleWriter(db as unknown as ConstructorParameters<typeof DrizzleWriter>[0], { orders: false });
    await w.write([{ kind: "fill", value: fill }]);
    expect(calls).toEqual(["insert:agent_fills"]);
  });
});

describe("row mapping", () => {
  it("maps sdk events to DB rows", () => {
    expect(toOrderRow(quote("h1"))).toMatchObject({ orderHash: "h1", postedAt: new Date(1_000), cancelledAt: null, provenance: "TESTNET" });
    expect(toFillRow(fill)).toMatchObject({ txHash: "0xabc", eventIndex: 2, executedAt: new Date(2_000) });
    expect(toGuardRow(guard)).toMatchObject({ id: "g1", observed: { oracleAgeSec: 41 }, at: new Date(3_000) });
    expect(toTunerRow(tuner)).toMatchObject({ id: "t1", mode: "shadow", model: "claude-opus-5-5", at: new Date(4_000) });
    expect(toTunerRow(tuner).payload).toMatchObject({ rationale: "Fills are balanced." });
  });
});
