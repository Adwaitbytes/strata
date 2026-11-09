/**
 * Liveness watchdog for long-running services (soak finding, 2026-11-09). A postgres.js pool can
 * sit on dead sockets after a network drop: queries hang for tens of minutes, then fail, while a
 * fresh connection works. The watchdog trips on N consecutive failed ticks or on no success within
 * stallMs (a hung query reports neither), and the caller exits non-zero so its supervisor restarts
 * the process with fresh pools and RPC clients. Restarting is simpler and safer than rebuilding a
 * pool that has already been handed to drizzle and every store.
 */

export type WatchdogTrip =
  | { reason: "consecutive_failures"; failures: number; lastError: string }
  | { reason: "stalled"; sinceSuccessMs: number };

export interface WatchdogConfig {
  maxConsecutiveFailures: number;
  stallMs: number;
}

export interface LivenessWatchdogOptions extends WatchdogConfig {
  onTrip: (trip: WatchdogTrip) => void;
  now?: () => number;
}

export const DEFAULT_MAX_CONSECUTIVE_FAILURES = 5;

export class LivenessWatchdog {
  readonly #o: LivenessWatchdogOptions;
  readonly #now: () => number;
  #lastSuccess: number;
  #failures = 0;
  #tripped = false;
  #timer: ReturnType<typeof setInterval> | null = null;

  constructor(options: LivenessWatchdogOptions) {
    this.#o = options;
    this.#now = options.now ?? Date.now;
    this.#lastSuccess = this.#now();
  }

  get consecutiveFailures(): number {
    return this.#failures;
  }

  success(): void {
    this.#failures = 0;
    this.#lastSuccess = this.#now();
  }

  failure(err: unknown): void {
    this.#failures++;
    if (this.#failures >= this.#o.maxConsecutiveFailures) {
      this.#trip({ reason: "consecutive_failures", failures: this.#failures, lastError: err instanceof Error ? err.message.slice(0, 300) : String(err).slice(0, 300) });
    }
  }

  check(): void {
    const since = this.#now() - this.#lastSuccess;
    if (since > this.#o.stallMs) this.#trip({ reason: "stalled", sinceSuccessMs: since });
  }

  start(checkEveryMs: number): void {
    if (this.#timer !== null) return;
    this.#timer = setInterval(() => this.check(), checkEveryMs);
    this.#timer.unref?.();
  }

  stop(): void {
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = null;
  }

  #trip(trip: WatchdogTrip): void {
    if (this.#tripped) return;
    this.#tripped = true;
    this.stop();
    this.#o.onTrip(trip);
  }
}

function positiveInt(name: string, raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${name} must be a positive integer, got ${JSON.stringify(raw)}`);
  return n;
}

/** DB_MAX_CONSECUTIVE_FAILURES (default 5) and DB_STALL_MS (default: the service's own window). */
export function watchdogConfigFromEnv(env: NodeJS.ProcessEnv, defaults: { stallMs: number }): WatchdogConfig {
  return {
    maxConsecutiveFailures: positiveInt("DB_MAX_CONSECUTIVE_FAILURES", env.DB_MAX_CONSECUTIVE_FAILURES, DEFAULT_MAX_CONSECUTIVE_FAILURES),
    stallMs: positiveInt("DB_STALL_MS", env.DB_STALL_MS, defaults.stallMs),
  };
}
