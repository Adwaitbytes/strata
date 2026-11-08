import { afterEach, describe, expect, it, vi } from "vitest";
import { resilientStream } from "./resilient-stream.js";

describe("resilientStream", () => {
  afterEach(() => vi.useRealTimers());

  it("reconnects quiet (stalled) streams after 1 s every time, and backs off on errors", () => {
    vi.useFakeTimers();
    let starts = 0;
    let fail: ((e: unknown) => void) | null = null;
    const h = resilientStream("t", (cb) => {
      starts += 1;
      fail = cb.onError;
    }, { stallMs: 10_000 });
    expect(starts).toBe(1);
    for (let i = 0; i < 4; i++) {
      vi.advanceTimersByTime(15_000 + 1_000);
    }
    const afterStalls = starts;
    expect(afterStalls).toBeGreaterThanOrEqual(4);
    fail!(new Error("x"));
    vi.advanceTimersByTime(999);
    expect(starts).toBe(afterStalls);
    vi.advanceTimersByTime(1);
    expect(starts).toBe(afterStalls + 1);
    fail!(new Error("y"));
    vi.advanceTimersByTime(1_500);
    expect(starts).toBe(afterStalls + 1);
    vi.advanceTimersByTime(600);
    expect(starts).toBe(afterStalls + 2);
    h.stop();
  });
});
