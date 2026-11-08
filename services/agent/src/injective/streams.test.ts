import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getEndpointSet } from "./endpoints.js";
import { ManagedStream } from "./streams.js";
import type { Subscription } from "./streams.js";

class FakeSub implements Subscription {
  errorHandlers: ((e: unknown) => void)[] = [];
  completeHandlers: (() => void)[] = [];
  unsubscribed = false;
  unsubscribe(): void {
    this.unsubscribed = true;
  }
  on(event: "error" | "complete", handler: ((e: unknown) => void) | (() => void)): void {
    if (event === "error") this.errorHandlers.push(handler as (e: unknown) => void);
    else this.completeHandlers.push(handler as () => void);
  }
  fail(): void {
    for (const h of this.errorHandlers) h(new Error("boom"));
  }
}

describe("ManagedStream", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("reconnects after an error, rotates endpoints and calls onReconnect", async () => {
    const set = getEndpointSet("mainnet");
    expect(set.bundles.length).toBeGreaterThan(1);
    const opened: string[] = [];
    const subs: FakeSub[] = [];
    const onReconnect = vi.fn();
    const s = new ManagedStream(set, {
      name: "t",
      baseBackoffMs: 10,
      maxBackoffMs: 20,
      onReconnect,
      open: (e) => {
        opened.push(e.indexer);
        const sub = new FakeSub();
        subs.push(sub);
        return sub;
      },
    });
    s.start();
    expect(opened).toHaveLength(1);
    subs[0]?.fail();
    expect(subs[0]?.unsubscribed).toBe(true);
    await vi.advanceTimersByTimeAsync(50);
    expect(opened).toHaveLength(2);
    expect(opened[1]).not.toBe(opened[0]);
    expect(onReconnect).toHaveBeenCalledTimes(1);
    expect(s.health().reconnects).toBe(1);
    s.close();
  });

  it("restarts a silent stream via the watchdog and stops cleanly on close", async () => {
    let opens = 0;
    const s = new ManagedStream(getEndpointSet("testnet"), {
      name: "idle",
      idleRestartMs: 4_000,
      baseBackoffMs: 1,
      maxBackoffMs: 1,
      open: () => {
        opens += 1;
        return new FakeSub();
      },
    });
    s.start();
    await vi.advanceTimersByTimeAsync(6_000);
    expect(opens).toBeGreaterThanOrEqual(2);
    s.close();
    const after = opens;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(opens).toBe(after);
    expect(s.health().connected).toBe(false);
  });

  it("touch() keeps a live stream from being restarted", async () => {
    let opens = 0;
    const s = new ManagedStream(getEndpointSet("testnet"), { name: "live", idleRestartMs: 4_000, open: () => (opens++, new FakeSub()) });
    s.start();
    for (let i = 0; i < 10; i++) {
      s.touch();
      await vi.advanceTimersByTimeAsync(1_000);
    }
    expect(opens).toBe(1);
    s.close();
  });
});
