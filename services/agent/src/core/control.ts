/**
 * Background control loops that run beside the quoting loop:
 * - KillCommandPoller: consumes signed admin kills that apps/api stored in `kill_commands`
 *   (PRD 9.6 b, review M-4) and acknowledges each one with a `kill_switch_api` guard event.
 * - HeartbeatWriter: publishes `agent:<id>` with the risk limits and capital the API shows on the
 *   Transparency page (W6 contract in docs/STATUS.md).
 */
import type { NetworkName, Provenance } from "@strata/sdk";
import type { RiskParams, RiskState } from "@strata/risk";
import type { KillSwitch } from "./killSwitch.js";
import type { AgentIdentity } from "./loop.js";
import type { HeartbeatSink, KillCommandFeed } from "./persistence.js";
import type { EventSink } from "./recorder.js";

export interface KillCommandPollerDeps {
  readonly feed: KillCommandFeed;
  readonly killSwitch: KillSwitch;
  readonly identity: AgentIdentity;
  readonly sink: Pick<EventSink, "guard">;
  readonly now: () => number;
  readonly ids: () => string;
  readonly intervalMs: number;
}

export class KillCommandPoller {
  readonly #d: KillCommandPollerDeps;
  readonly #acked = new Set<string>();
  #timer: ReturnType<typeof setInterval> | null = null;
  #polling: Promise<number> | null = null;
  #onError: (err: unknown) => void = () => undefined;

  constructor(deps: KillCommandPollerDeps) {
    this.#d = deps;
  }

  /** Returns the number of commands acted on. */
  pollOnce(): Promise<number> {
    this.#polling ??= this.#poll().finally(() => {
      this.#polling = null;
    });
    return this.#polling;
  }

  async #poll(): Promise<number> {
    const { identity, killSwitch, sink } = this.#d;
    const rows = await this.#d.feed.pending(identity.network, identity.agentId);
    let n = 0;
    for (const row of rows) {
      if (this.#acked.has(row.id)) continue;
      if (row.targetAgentId !== null && row.targetAgentId !== identity.agentId) continue;
      killSwitch.trigger({ target: row.targetAgentId ?? "all", closePositions: row.closePositions, source: "api", at: this.#d.now() });
      sink.guard({
        network: identity.network,
        provenance: identity.provenance,
        id: this.#d.ids(),
        agentId: identity.agentId,
        marketId: null,
        guard: "kill_switch",
        action: "halt",
        reason: "kill_switch_api",
        detail: `Signed admin kill received; all orders cancelled${row.closePositions ? " and a reduce-only close requested" : ""}.`,
        observed: { killCommandId: row.id, closePositions: row.closePositions },
        at: this.#d.now(),
      });
      this.#acked.add(row.id);
      n++;
    }
    return n;
  }

  /** Called on LISTEN strata_kill notifications for low latency. */
  notify(): void {
    this.pollOnce().catch(this.#onError);
  }

  start(onError: (err: unknown) => void = () => undefined): void {
    if (this.#timer !== null) return;
    this.#onError = onError;
    this.#timer = setInterval(() => this.notify(), this.#d.intervalMs);
    this.#timer.unref?.();
  }

  stop(): void {
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = null;
  }
}

export interface HeartbeatInput {
  readonly name: string;
  readonly capitalUsd: number;
  readonly params: RiskParams;
  readonly tickers: readonly string[];
  readonly killed: boolean;
  readonly risk: RiskState;
  readonly tunerMode: string;
  readonly provenance: Provenance;
}

export function heartbeatDetail(i: HeartbeatInput): {
  limits: Record<string, number | string | boolean>;
  capitalUsd: number;
  [k: string]: unknown;
} {
  return {
    agent: i.name,
    capitalUsd: i.capitalUsd,
    limits: { ...i.params },
    markets: [...i.tickers],
    killed: i.killed,
    stoppedForDay: i.risk.stoppedForDay,
    stoppedForSeason: i.risk.stoppedForSeason,
    tunerMode: i.tunerMode,
    provenance: i.provenance,
  };
}

export interface HeartbeatWriterDeps {
  readonly sink: HeartbeatSink;
  readonly network: NetworkName;
  readonly agentId: number;
  readonly now: () => number;
  readonly detail: () => Record<string, unknown>;
  readonly intervalMs: number;
}

export class HeartbeatWriter {
  readonly #d: HeartbeatWriterDeps;
  #timer: ReturnType<typeof setInterval> | null = null;

  constructor(deps: HeartbeatWriterDeps) {
    this.#d = deps;
  }

  beat(): Promise<void> {
    return this.#d.sink.write(this.#d.network, `agent:${this.#d.agentId}`, this.#d.now(), this.#d.detail());
  }

  start(onError: (err: unknown) => void = () => undefined, onSuccess: () => void = () => undefined): void {
    if (this.#timer !== null) return;
    const run = (): void => void this.beat().then(onSuccess, onError);
    run();
    this.#timer = setInterval(run, this.#d.intervalMs);
    this.#timer.unref?.();
  }

  stop(): void {
    if (this.#timer !== null) clearInterval(this.#timer);
    this.#timer = null;
  }
}
