import { describe, expect, it } from "vitest";
import { CALENDAR, DEFAULT_PARAMS, zonedTimeToUtc, type RiskParams } from "@strata/risk";
import type { GuardEvent } from "@strata/sdk";
import { KillSwitch } from "../core/killSwitch.js";
import { OptionsBook, type SimPosition } from "./book.js";
import { MemoryOptionsStore, OptionsRunner, type OptionsRunnerParams, type PriceReading, type UnderlyingSpec } from "./runner.js";

const US500: UnderlyingSpec = { underlying: "US500", marketId: "0x7b3bcf125dfa50ae8d44ecb60119ef5d52a627ad757b727850b0903b55e49b2c", sessionClass: "us_equity" };
const SICI: UnderlyingSpec = { underlying: "SICI", marketId: "0x6751442adea73a2b65adce484dd7bde25d204c9695fc9d5410933171f3417410", sessionClass: "always_open" };

const identity = { agentId: 9001, agentName: "strata-options", network: "testnet" as const, provenance: "SIMULATED" as const };

const params: OptionsRunnerParams = {
  strategy: {
    targetAbsDelta: 0.2,
    minAbsDelta: 0.15,
    maxAbsDelta: 0.3,
    volFloor: 0.08,
    ivFloorMultiple: 1.2,
    collateralPerWriteUsd: 500,
    callCapMultiple: 1,
    // Buyers always take the quote so the tests are about the writer, not the draw.
    baseFillProbability: 1,
    fillDecay: 0,
  },
  maxOracleAgeSec: 120,
  minTenorMs: 86_400_000,
  maxOpenPerSeries: 2,
  maxCollateralPerUnderlyingUsd: 5_000,
  closeSpread: 0.05,
  ewmaHalfLifeSec: 3_600,
  minReturns: 3,
};
const risk: RiskParams = { ...DEFAULT_PARAMS, maxDailyLossUsd: 300, maxDrawdownUsd: 800, maxGrossNotionalUsd: 100_000, maxNetNotionalUsd: 50_000 };

// Monday 2026-11-09 11:00 New York, US equity session open.
const T0 = zonedTimeToUtc(2026, 11, 9, 11, 0, 0, CALENDAR.timezone);

function harness(opts: { cash?: number; specs?: UnderlyingSpec[]; prices?: (spec: UnderlyingSpec, now: number) => PriceReading | null } = {}) {
  let now = T0;
  const guards: GuardEvent[] = [];
  const store = new MemoryOptionsStore();
  const killSwitch = new KillSwitch(identity);
  const book = new OptionsBook({ cashUsd: opts.cash ?? 10_000, callCapMultiple: 1 });
  let n = 0;
  const priceFn = opts.prices ?? ((_s, t) => ({ price: 700 * (1 + 0.002 * Math.sin(t / 60_000)), timestampMs: t - 1_000, source: "test" }));
  const runner = new OptionsRunner({
    identity,
    specs: opts.specs ?? [US500],
    prices: {
      read: async (spec) => {
        const r = priceFn(spec, now);
        if (r === null) throw new Error("no price");
        return r;
      },
    },
    store,
    sink: { guard: (e) => guards.push(e) },
    killSwitch,
    book,
    params,
    riskParams: risk,
    initialRisk: null,
    now: () => now,
    ids: () => `id-${n++}`,
  });
  const warm = async (cycles = 5) => {
    for (let i = 0; i < cycles; i++) {
      await runner.cycle({ quote: false });
      now += 60_000;
    }
  };
  return { runner, store, guards, killSwitch, book, warm, setNow: (t: number) => (now = t), getNow: () => now };
}

describe("OptionsRunner", () => {
  it("writes covered calls and cash-secured puts once vol is warm, all labeled SIMULATED", async () => {
    const h = harness();
    await h.warm();
    await h.runner.cycle({ quote: true });
    const kinds = h.store.positions.map((p) => p.kind).sort();
    expect(kinds).toEqual(["call", "put"]);
    expect(h.store.quotes.every((q) => q.provenance === "SIMULATED" && q.outcome === "written")).toBe(true);
    expect(h.store.books.at(-1)?.provenance).toBe("SIMULATED");
    for (const q of h.store.quotes) {
      expect(Math.abs(q.delta)).toBeGreaterThanOrEqual(0.15);
      expect(Math.abs(q.delta)).toBeLessThanOrEqual(0.3);
      expect(q.impliedVol).toBeGreaterThanOrEqual(q.realizedVol * 1.2 - 1e-6);
    }
    expect(h.book.lockedCollateralUsd()).toBeCloseTo(h.store.positions.reduce((s, p) => s + p.collateralUsd, 0), 6);
  });

  it("does not quote before realized vol has enough returns", async () => {
    const h = harness();
    await h.runner.cycle({ quote: true });
    expect(h.store.quotes).toHaveLength(0);
  });

  it("stops at maxOpenPerSeries per underlying and kind", async () => {
    const h = harness();
    await h.warm();
    for (let i = 0; i < 4; i++) await h.runner.cycle({ quote: true });
    expect(h.book.open().filter((p) => p.kind === "call")).toHaveLength(2);
  });

  it("rejects a write it cannot fully collateralize and records a guard event", async () => {
    const h = harness({ cash: 300 });
    await h.warm();
    await h.runner.cycle({ quote: true });
    expect(h.book.open()).toHaveLength(0);
    expect(h.store.quotes.every((q) => q.outcome === "rejected_collateral")).toBe(true);
    expect(h.guards.some((g) => g.guard === "risk" && g.observed["check"] === "full_collateral" && g.provenance === "SIMULATED")).toBe(true);
  });

  it("does not write while the underlying session is closed and records the session guard once", async () => {
    const h = harness();
    await h.warm();
    h.setNow(zonedTimeToUtc(2026, 11, 14, 12, 0, 0, CALENDAR.timezone)); // Saturday
    await h.runner.cycle({ quote: true });
    await h.runner.cycle({ quote: true });
    expect(h.book.open()).toHaveLength(0);
    expect(h.guards.filter((g) => g.reason === "session_closed")).toHaveLength(1);
  });

  it("keeps a session guard raised across cycles that do not quote", async () => {
    const h = harness();
    await h.warm();
    h.setNow(zonedTimeToUtc(2026, 11, 14, 12, 0, 0, CALENDAR.timezone)); // Saturday
    await h.runner.cycle({ quote: true });
    await h.runner.cycle({ quote: false });
    await h.runner.cycle({ quote: true });
    expect(h.guards.filter((g) => g.reason === "session_closed")).toHaveLength(1);
  });

  it("halts writes on a stale oracle", async () => {
    const h = harness({ specs: [SICI], prices: (_s, t) => ({ price: 100 + (t / 60_000) % 3, timestampMs: t < T0 + 300_000 ? t : T0 - 3_600_000, source: "test" }) });
    await h.warm();
    await h.runner.cycle({ quote: true });
    expect(h.book.open()).toHaveLength(0);
    expect(h.guards.some((g) => g.reason === "oracle_stale")).toBe(true);
  });

  it("never writes after the kill switch and closes positions when asked", async () => {
    const h = harness();
    await h.warm();
    await h.runner.cycle({ quote: true });
    expect(h.book.open().length).toBeGreaterThan(0);
    h.killSwitch.trigger({ target: "all", closePositions: true, source: "env", at: h.getNow() });
    await h.runner.cycle({ quote: true });
    expect(h.book.open()).toHaveLength(0);
    expect(h.store.positions.filter((p) => p.status === "closed_early").length).toBeGreaterThan(0);
    const writes = h.store.quotes.length;
    await h.runner.cycle({ quote: true });
    expect(h.store.quotes.length).toBe(writes);
  });

  it("settles expired options on the oracle and releases collateral", async () => {
    const h = harness();
    await h.warm();
    await h.runner.cycle({ quote: true });
    const expiry = h.book.open()[0]!.expiryMs;
    h.setNow(expiry + 1_000);
    await h.runner.cycle({ quote: false });
    const settled = h.store.positions.filter((p) => p.status === "settled");
    expect(settled.length).toBe(2);
    expect(settled.every((p: SimPosition) => p.payoutUsd !== null && p.payoutUsd <= p.collateralUsd)).toBe(true);
    expect(h.book.lockedCollateralUsd()).toBe(0);
  });

  it("stops writing and closes the book when the daily loss limit is hit", async () => {
    let level = 700;
    const h = harness({ prices: (_s, t) => ({ price: level * (1 + 0.002 * Math.sin(t / 60_000)), timestampMs: t - 1_000, source: "test" }) });
    await h.warm();
    await h.runner.cycle({ quote: true });
    level = 1_400; // calls go deep in the money
    await h.runner.cycle({ quote: true });
    expect(h.guards.some((g) => g.reason === "risk_daily_loss" || g.reason === "risk_max_drawdown")).toBe(true);
    expect(h.book.open()).toHaveLength(0);
    const quotes = h.store.quotes.length;
    await h.runner.cycle({ quote: true });
    expect(h.store.quotes.length).toBe(quotes);
  });
});
