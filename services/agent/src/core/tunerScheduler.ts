/**
 * Runs the AI Risk Tuner for one market every 5 to 15 minutes (PRD 9.7). In shadow mode the
 * suggestion is only recorded; in live mode the bounded values go into the ParamStore, which
 * clamps again. The tuner never touches orders.
 */
import type { TunerEvent } from "@strata/sdk";
import type { RiskParams } from "@strata/risk";
import type { AgentIdentity, QuoterStats } from "./loop.js";
import type { ParamStore } from "./paramStore.js";
import type { EventSink } from "./recorder.js";
import { runTunerStep, type TunerClient, type TunerSnapshot } from "./tuner.js";

const round2 = (v: number): number => Math.round(v * 100) / 100 + 0;

export function snapshotFromStats(ticker: string, stats: QuoterStats, params: RiskParams, windowMin: number): Omit<TunerSnapshot, "current"> {
  return {
    market: ticker,
    sessionState: stats.sessionState ?? "open",
    realizedVolBps: round2(stats.sigmaBps),
    fills: { ...stats.fills, windowMin },
    markoutsBps: stats.markoutsBps,
    inventoryUsd: round2(stats.fair === null ? 0 : stats.inventoryBase * stats.fair),
    inventoryCapUsd: params.inventoryCapUsd,
    recentGuardReasons: stats.recentGuardReasons,
    fundingRateHourlyBps: stats.fundingRateHourly === null ? null : round2(stats.fundingRateHourly * 1e4),
  };
}

export interface TunerSchedulerDeps {
  readonly client: TunerClient;
  readonly mode: "shadow" | "live";
  readonly quoter: { stats(windowMs: number): QuoterStats };
  readonly ticker: string;
  readonly marketId: string;
  readonly store: ParamStore;
  readonly sink: Pick<EventSink, "tuner">;
  readonly identity: AgentIdentity;
  readonly ids: () => string;
  readonly now: () => number;
  readonly intervalMs: number;
}

export class TunerScheduler {
  readonly #d: TunerSchedulerDeps;
  readonly #intervalMs: number;
  #timer: ReturnType<typeof setInterval> | null = null;

  static clampInterval(ms: number): number {
    return Math.min(15 * 60_000, Math.max(5 * 60_000, ms));
  }

  constructor(deps: TunerSchedulerDeps) {
    this.#d = deps;
    this.#intervalMs = TunerScheduler.clampInterval(deps.intervalMs);
  }

  async step(): Promise<TunerEvent> {
    const d = this.#d;
    const current = d.store.tunable();
    const snapshot: TunerSnapshot = { ...snapshotFromStats(d.ticker, d.quoter.stats(this.#intervalMs), d.store.get(), Math.round(this.#intervalMs / 60_000)), current };
    const { event, next } = await runTunerStep({
      client: d.client,
      snapshot,
      current,
      mode: d.mode,
      network: d.identity.network,
      agentId: d.identity.agentId,
      marketId: d.marketId,
      id: d.ids(),
      at: d.now(),
    });
    d.sink.tuner(event);
    if (d.mode === "live" && !event.rejected) d.store.applyTunable(next);
    return event;
  }

  start(onError: (err: unknown) => void = () => undefined): void {
    if (this.#timer !== null) return;
    this.#timer = setInterval(() => {
      this.step().catch(onError);
    }, this.#intervalMs);
    this.#timer.unref?.();
  }

  stop(): void {
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = null;
  }
}
