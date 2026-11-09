/**
 * The scorer's scheduling loop: tick, heartbeat, exponential backoff on failure. Every outcome is
 * reported to a LivenessWatchdog; main.ts exits 1 when it trips so the supervisor restarts the
 * process with a fresh pool and RPC client (soak finding 2026-11-09).
 */
import { setTimeout as delay } from "node:timers/promises";
import type { LivenessWatchdog } from "@strata/db";
import type { Logger } from "./runner.js";

export interface ScorerLoopDeps {
  tick: () => Promise<void>;
  heartbeat: (detail: Record<string, unknown>) => Promise<void>;
  pollMs: number;
  maxBackoffFactor: number;
  once: boolean;
  signal: AbortSignal;
  watchdog: Pick<LivenessWatchdog, "success" | "failure">;
  log: Logger;
  dryRun?: boolean;
  onSuccess?: () => void;
}

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Runs until the signal aborts (or one tick with `once`). Returns the process exit code. */
export async function runScorerLoop(d: ScorerLoopDeps): Promise<number> {
  let failures = 0;
  let exitCode = 0;
  while (!d.signal.aborted) {
    try {
      await d.tick();
      await d.heartbeat({ ok: true, dryRun: d.dryRun ?? false });
      failures = 0;
      d.watchdog.success();
      d.onSuccess?.();
    } catch (err) {
      failures++;
      exitCode = 1;
      d.log.error("tick failed", { error: errorMessage(err), consecutiveFailures: failures });
      await d.heartbeat({ ok: false, error: errorMessage(err), consecutiveFailures: failures }).catch((hbErr: unknown) => {
        d.log.error("heartbeat write failed", { error: errorMessage(hbErr) });
      });
      d.watchdog.failure(err);
    }
    if (d.once || d.signal.aborted) break;
    const wait = d.pollMs * Math.min(2 ** failures, d.maxBackoffFactor);
    await delay(wait, undefined, { signal: d.signal }).catch(() => undefined);
  }
  // A long-running loop ends only on SIGTERM/SIGINT, which is a clean stop.
  return d.once ? exitCode : 0;
}
