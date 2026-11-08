import { describe, expect, it, vi } from "vitest";
import type { TunerEvent } from "@strata/sdk";
import { DEFAULT_PARAMS } from "@strata/risk";
import { ParamStore } from "./paramStore.js";
import { TunerScheduler, snapshotFromStats } from "./tunerScheduler.js";
import type { QuoterStats } from "./loop.js";
import type { TunerClient } from "./tuner.js";

const M = `0x${"a".repeat(64)}`;
const stats: QuoterStats = {
  sigmaBps: 1.234567,
  fair: 100,
  inventoryBase: 0.5,
  sessionState: "open",
  fundingRateHourly: 0.0001,
  fills: { buy: 2, sell: 3 },
  markoutsBps: { s1: 0.5, s10: null, s60: null },
  recentGuardReasons: ["oracle_stale"],
};
const identity = { agentId: 1, agentName: "strata-test-1", network: "testnet" as const, provenance: "TESTNET" as const };
const reply = JSON.stringify({ gamma: 0.2, minHalfSpreadBps: 12, levels: 3, sizeMultiplier: 1, offHoursQuoting: false, rationale: "Volatility rose, so risk aversion goes up." });
const client = (text = reply): TunerClient => ({ model: "stub", suggest: vi.fn(async () => ({ text, refused: false })) });

function make(mode: "shadow" | "live", c: TunerClient = client()) {
  const store = new ParamStore(DEFAULT_PARAMS);
  const events: TunerEvent[] = [];
  const sched = new TunerScheduler({
    client: c,
    mode,
    quoter: { stats: () => stats },
    ticker: "XAU/USDC PERP",
    marketId: M,
    store,
    sink: { tuner: (e) => events.push(e) },
    identity,
    ids: () => "tuner-evt",
    now: () => 1_780_000_000_000,
    intervalMs: 10 * 60_000,
  });
  return { store, events, sched };
}

describe("snapshotFromStats", () => {
  it("builds a compact, rounded snapshot", () => {
    const s = snapshotFromStats("XAU/USDC PERP", stats, DEFAULT_PARAMS, 15);
    expect(s).toMatchObject({
      market: "XAU/USDC PERP",
      realizedVolBps: 1.23,
      inventoryUsd: 50,
      inventoryCapUsd: DEFAULT_PARAMS.inventoryCapUsd,
      fundingRateHourlyBps: 1,
      fills: { buy: 2, sell: 3, windowMin: 15 },
      sessionState: "open",
    });
    expect(snapshotFromStats("X", { ...stats, fair: null, sessionState: null, fundingRateHourly: null }, DEFAULT_PARAMS, 15)).toMatchObject({
      inventoryUsd: 0,
      sessionState: "open",
      fundingRateHourlyBps: null,
    });
  });
});

describe("TunerScheduler", () => {
  it("shadow: records the event and leaves params unchanged", async () => {
    const { store, events, sched } = make("shadow");
    const e = await sched.step();
    expect(events).toEqual([e]);
    expect(e.mode).toBe("shadow");
    expect(store.get().gamma).toBe(DEFAULT_PARAMS.gamma);
  });

  it("live: applies the bounded suggestion", async () => {
    const { store, sched } = make("live");
    const e = await sched.step();
    expect(e.applied?.gamma).toBeCloseTo(0.12, 10);
    expect(store.get().gamma).toBeCloseTo(0.12, 10);
    expect(store.get().minHalfSpreadBps).toBe(12);
  });

  it("live: a rejected suggestion changes nothing", async () => {
    const { store, sched } = make("live", client("nope"));
    const e = await sched.step();
    expect(e.rejected).toBe(true);
    expect(store.get()).toEqual(DEFAULT_PARAMS);
  });

  it("runs on an interval clamped to 5 to 15 minutes and stops", async () => {
    vi.useFakeTimers();
    try {
      const { events, sched } = make("shadow");
      sched.start();
      sched.start();
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(events).toHaveLength(1);
      sched.stop();
      await vi.advanceTimersByTimeAsync(30 * 60_000);
      expect(events).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
    expect(TunerScheduler.clampInterval(60_000)).toBe(5 * 60_000);
    expect(TunerScheduler.clampInterval(3_600_000)).toBe(15 * 60_000);
  });

  it("reports step failures to onError instead of throwing from the timer", async () => {
    vi.useFakeTimers();
    try {
      const onError = vi.fn();
      const { sched } = make("shadow");
      vi.spyOn(sched, "step").mockRejectedValue(new Error("boom"));
      sched.start(onError);
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      expect(onError).toHaveBeenCalledOnce();
      sched.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
