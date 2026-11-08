/**
 * Fixed-window rate-limit counters held in process memory only.
 * PRD 16.3: client IPs must not outlive the rate-limit window, so expired keys are
 * swept on a timer instead of lingering in an LRU until evicted.
 */
import type { FastifyRateLimitStore, FastifyRateLimitStoreCtor } from "@fastify/rate-limit";

interface Entry {
  count: number;
  windowStart: number;
  windowMs: number;
}

type IncrCallback = (error: Error | null, result?: { current: number; ttl: number }) => void;

export class WindowStore implements FastifyRateLimitStore {
  private readonly entries = new Map<string, Entry>();
  /** Route-level limits get their own counters so they never share a budget with the global limit. */
  private readonly children: WindowStore[] = [];
  private readonly now: () => number;

  constructor(options: { now?: () => number } = {}) {
    this.now = options.now ?? Date.now;
  }

  get size(): number {
    return this.entries.size;
  }

  incr(key: string, callback: IncrCallback, timeWindow?: number): void {
    const windowMs = timeWindow ?? 60_000;
    const t = this.now();
    let e = this.entries.get(key);
    if (!e || e.windowStart + e.windowMs <= t) {
      e = { count: 0, windowStart: t, windowMs };
      this.entries.set(key, e);
    }
    e.count += 1;
    callback(null, { current: e.count, ttl: e.windowStart + e.windowMs - t });
  }

  /** Drop every entry whose window has ended. */
  sweep(): void {
    const t = this.now();
    for (const [k, e] of this.entries) if (e.windowStart + e.windowMs <= t) this.entries.delete(k);
    for (const c of this.children) c.sweep();
  }

  child(): FastifyRateLimitStore {
    const c = new WindowStore({ now: this.now });
    this.children.push(c);
    return c;
  }
}

/** Store class for @fastify/rate-limit that sweeps itself every `sweepMs`. */
export function sweepingStoreClass(sweepMs: number): FastifyRateLimitStoreCtor {
  return class SweepingWindowStore extends WindowStore {
    constructor() {
      super();
      setInterval(() => this.sweep(), sweepMs).unref();
    }
  };
}
