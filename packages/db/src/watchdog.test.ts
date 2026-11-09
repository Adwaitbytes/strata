import { describe, expect, it, vi } from "vitest";
import { LivenessWatchdog, watchdogConfigFromEnv, type WatchdogTrip } from "./watchdog.js";

function setup(over: { maxConsecutiveFailures?: number; stallMs?: number } = {}) {
  let t = 0;
  const trips: WatchdogTrip[] = [];
  const w = new LivenessWatchdog({
    maxConsecutiveFailures: over.maxConsecutiveFailures ?? 5,
    stallMs: over.stallMs ?? 60_000,
    now: () => t,
    onTrip: (trip) => void trips.push(trip),
  });
  return { w, trips, advance: (ms: number) => void (t += ms) };
}

describe("LivenessWatchdog", () => {
  it("trips once after N consecutive failures", () => {
    const { w, trips } = setup({ maxConsecutiveFailures: 5 });
    for (let i = 0; i < 4; i++) w.failure(new Error("Failed query"));
    expect(trips).toEqual([]);
    w.failure(new Error("Failed query"));
    w.failure(new Error("Failed query"));
    expect(trips).toEqual([{ reason: "consecutive_failures", failures: 5, lastError: "Failed query" }]);
  });

  it("a success resets the failure streak", () => {
    const { w, trips } = setup({ maxConsecutiveFailures: 3 });
    w.failure(new Error("a"));
    w.failure(new Error("b"));
    w.success();
    w.failure(new Error("c"));
    w.failure(new Error("d"));
    expect(trips).toEqual([]);
    expect(w.consecutiveFailures).toBe(2);
  });

  it("trips as stalled when nothing succeeds within stallMs, even with no failures reported (hung query)", () => {
    const { w, trips, advance } = setup({ stallMs: 60_000 });
    w.success();
    advance(59_000);
    w.check();
    expect(trips).toEqual([]);
    advance(2_000);
    w.check();
    expect(trips).toEqual([{ reason: "stalled", sinceSuccessMs: 61_000 }]);
  });

  it("start() checks on an interval and stop() ends it", () => {
    vi.useFakeTimers();
    try {
      const onTrip = vi.fn();
      const w = new LivenessWatchdog({ maxConsecutiveFailures: 5, stallMs: 10_000, onTrip });
      w.start(1_000);
      vi.advanceTimersByTime(9_000);
      expect(onTrip).not.toHaveBeenCalled();
      vi.advanceTimersByTime(2_000);
      expect(onTrip).toHaveBeenCalledWith(expect.objectContaining({ reason: "stalled" }));
      w.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("watchdogConfigFromEnv", () => {
  it("defaults to 5 failures and the caller's stall window", () => {
    expect(watchdogConfigFromEnv({}, { stallMs: 120_000 })).toEqual({ maxConsecutiveFailures: 5, stallMs: 120_000 });
  });

  it("reads DB_MAX_CONSECUTIVE_FAILURES and DB_STALL_MS", () => {
    expect(watchdogConfigFromEnv({ DB_MAX_CONSECUTIVE_FAILURES: "3", DB_STALL_MS: "30000" }, { stallMs: 1 })).toEqual({
      maxConsecutiveFailures: 3,
      stallMs: 30_000,
    });
  });

  it("rejects invalid values", () => {
    expect(() => watchdogConfigFromEnv({ DB_MAX_CONSECUTIVE_FAILURES: "0" }, { stallMs: 1 })).toThrow();
    expect(() => watchdogConfigFromEnv({ DB_STALL_MS: "soon" }, { stallMs: 1 })).toThrow();
  });
});
