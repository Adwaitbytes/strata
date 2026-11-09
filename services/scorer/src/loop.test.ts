/**
 * Soak finding (2026-11-09): the scorer's ticks failed for 2.5 h ("Failed query" on every tick,
 * some ticks hanging for tens of minutes) and only a restart helped. The loop now reports to a
 * LivenessWatchdog that trips on consecutive failures or on a hung tick (database or RPC).
 */
import { describe, expect, it, vi } from "vitest";
import { LivenessWatchdog, type WatchdogTrip } from "@strata/db";
import { runScorerLoop } from "./loop.js";

const quietLog = { info: () => undefined, warn: () => undefined, error: () => undefined };

describe("runScorerLoop liveness", () => {
  it("trips after 5 consecutive failed ticks and stops looping", async () => {
    const trips: WatchdogTrip[] = [];
    const stop = new AbortController();
    const watchdog = new LivenessWatchdog({ maxConsecutiveFailures: 5, stallMs: 60_000, onTrip: (t) => (trips.push(t), stop.abort()) });
    const tick = vi.fn(() => Promise.reject(new Error("Failed query: select max(epoch)")));
    const heartbeat = vi.fn(() => Promise.reject(new Error("Failed query: insert into heartbeats")));
    await runScorerLoop({ tick, heartbeat, pollMs: 1, maxBackoffFactor: 1, once: false, signal: stop.signal, watchdog, log: quietLog });
    expect(tick).toHaveBeenCalledTimes(5);
    expect(trips).toEqual([expect.objectContaining({ reason: "consecutive_failures", failures: 5, lastError: "Failed query: select max(epoch)" })]);
  });

  it("a successful tick and heartbeat resets the streak", async () => {
    const stop = new AbortController();
    const onTrip = vi.fn();
    const watchdog = new LivenessWatchdog({ maxConsecutiveFailures: 2, stallMs: 60_000, onTrip });
    let n = 0;
    const tick = vi.fn(async () => {
      n++;
      if (n === 6) stop.abort();
      if (n % 2 === 1) throw new Error("rpc timeout");
    });
    await runScorerLoop({ tick, heartbeat: async () => undefined, pollMs: 1, maxBackoffFactor: 1, once: false, signal: stop.signal, watchdog, log: quietLog });
    expect(onTrip).not.toHaveBeenCalled();
  });

  it("a hung tick (RPC or query that never settles) trips as stalled", async () => {
    vi.useFakeTimers();
    try {
      const onTrip = vi.fn();
      const watchdog = new LivenessWatchdog({ maxConsecutiveFailures: 5, stallMs: 30_000, onTrip });
      watchdog.start(1_000);
      void runScorerLoop({ tick: () => new Promise(() => undefined), heartbeat: async () => undefined, pollMs: 1, maxBackoffFactor: 1, once: false, signal: new AbortController().signal, watchdog, log: quietLog });
      await vi.advanceTimersByTimeAsync(32_000);
      expect(onTrip).toHaveBeenCalledWith(expect.objectContaining({ reason: "stalled" }));
    } finally {
      vi.useRealTimers();
    }
  });

  it("--once returns 1 on failure", async () => {
    const watchdog = new LivenessWatchdog({ maxConsecutiveFailures: 5, stallMs: 60_000, onTrip: () => undefined });
    const code = await runScorerLoop({ tick: () => Promise.reject(new Error("x")), heartbeat: async () => undefined, pollMs: 1, maxBackoffFactor: 1, once: true, signal: new AbortController().signal, watchdog, log: quietLog });
    expect(code).toBe(1);
  });
});
