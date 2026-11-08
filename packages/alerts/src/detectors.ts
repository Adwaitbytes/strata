import type { NetworkName } from "@strata/sdk";
import type { Alert } from "./alerts.js";

/** PRD 15.3: alert when data lag exceeds 60 seconds. */
export const DATA_LAG_THRESHOLD_SEC = 60;

export interface TxFailureSpikeOptions {
  readonly network: NetworkName;
  readonly service: string;
  readonly windowSec?: number;
  /** Failure share in the window that counts as a spike. Default 0.3. */
  readonly failureRatio?: number;
  /** Ignore windows with fewer attempts than this, so 1 failure of 1 is not a spike. */
  readonly minSamples?: number;
}

/**
 * Sliding window over tx outcomes. Call `record` after every broadcast; it returns a
 * `tx_failure_spike` alert when the window crosses the threshold, else null. Repeat
 * suppression is the alerter's job, so this stays a pure function of the window.
 */
export class TxFailureTracker {
  readonly #opts: Required<TxFailureSpikeOptions>;
  readonly #events: { at: number; ok: boolean }[] = [];
  #lastError: string | null = null;

  constructor(opts: TxFailureSpikeOptions) {
    this.#opts = { windowSec: 300, failureRatio: 0.3, minSamples: 5, ...opts };
  }

  record(ok: boolean, nowMs: number, error?: string): Alert | null {
    this.#events.push({ at: nowMs, ok });
    if (!ok && error !== undefined) this.#lastError = error;
    const cutoff = nowMs - this.#opts.windowSec * 1000;
    while (this.#events.length > 0 && this.#events[0]!.at < cutoff) this.#events.shift();

    const total = this.#events.length;
    const failures = this.#events.reduce((n, e) => n + (e.ok ? 0 : 1), 0);
    if (total < this.#opts.minSamples || failures / total < this.#opts.failureRatio) return null;
    return {
      kind: "tx_failure_spike",
      network: this.#opts.network,
      service: this.#opts.service,
      failures,
      total,
      windowSec: this.#opts.windowSec,
      lastError: this.#lastError,
    };
  }
}

/** Returns a `data_lag` alert when the newest datum is older than the threshold. */
export function checkDataLag(args: {
  readonly network: NetworkName;
  readonly source: string;
  readonly lastDataAtMs: number;
  readonly nowMs: number;
  readonly thresholdSec?: number;
}): Alert | null {
  const thresholdSec = args.thresholdSec ?? DATA_LAG_THRESHOLD_SEC;
  const lagSec = (args.nowMs - args.lastDataAtMs) / 1000;
  if (lagSec <= thresholdSec) return null;
  return { kind: "data_lag", network: args.network, source: args.source, lagSec, thresholdSec };
}
