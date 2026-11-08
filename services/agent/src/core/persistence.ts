/**
 * Durable agent safety state (security review H-2, L-7). The Risk Governor stops, the peak equity
 * used for drawdown, and the kill latch survive restarts; consumed admin nonces are shared with
 * the API through `admin_nonces`. Without this, any crash or `docker compose up` would grant a
 * fresh daily-loss and drawdown budget.
 */
import { and, eq, sql as dsql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { z } from "zod";
import { adminNonces, agentRiskState, guardEvents, heartbeats, killCommands } from "@strata/db";
import type { NetworkName } from "@strata/sdk";
import type { RiskState } from "@strata/risk";
import type { KillState, NonceStore } from "./killSwitch.js";

export const PersistedAgentState = z.object({
  risk: z.object({
    dayKey: z.string().nullable(),
    dayStartEquityUsd: z.number().nullable(),
    peakEquityUsd: z.number().nullable(),
    stoppedForDay: z.boolean(),
    stoppedForSeason: z.boolean(),
  }),
  kill: z.object({
    killed: z.boolean(),
    closePositions: z.boolean(),
    source: z.enum(["telegram", "api", "env"]).nullable(),
    at: z.number().nullable(),
  }),
});
export type PersistedAgentState = z.infer<typeof PersistedAgentState>;

export function persistable(risk: RiskState, kill: KillState): PersistedAgentState {
  return {
    risk: {
      dayKey: risk.dayKey,
      dayStartEquityUsd: risk.dayStartEquityUsd,
      peakEquityUsd: risk.peakEquityUsd,
      stoppedForDay: risk.stoppedForDay,
      stoppedForSeason: risk.stoppedForSeason,
    },
    kill: { ...kill },
  };
}

export function riskStateFrom(saved: PersistedAgentState): RiskState {
  return { ...saved.risk, orderTimesMs: [] };
}

export interface AgentStateStore {
  load(network: NetworkName, agentId: number): Promise<PersistedAgentState | null>;
  save(network: NetworkName, agentId: number, state: PersistedAgentState, at: number): Promise<void>;
}

export class MemoryAgentStateStore implements AgentStateStore {
  readonly #rows = new Map<string, PersistedAgentState>();
  async load(network: NetworkName, agentId: number): Promise<PersistedAgentState | null> {
    return this.#rows.get(`${network}:${agentId}`) ?? null;
  }
  async save(network: NetworkName, agentId: number, state: PersistedAgentState, _at?: number): Promise<void> {
    this.#rows.set(`${network}:${agentId}`, structuredClone(state));
  }
}

/**
 * Writes state whenever it changes, one write at a time, latest value wins. Never blocks the
 * caller; failures are reported and retried on the next change or `flush`.
 */
export class StatePersister {
  #lastSaved: string | null;
  #pending: PersistedAgentState | null = null;
  #writing: Promise<void> | null = null;

  constructor(
    private readonly store: AgentStateStore,
    private readonly network: NetworkName,
    private readonly agentId: number,
    private readonly now: () => number,
    private readonly onError: (err: unknown) => void,
    initial: PersistedAgentState | null,
  ) {
    this.#lastSaved = initial === null ? null : JSON.stringify(initial);
  }

  update(state: PersistedAgentState): void {
    const key = JSON.stringify(state);
    if (key === this.#lastSaved && this.#pending === null) return;
    this.#pending = state;
    void this.flush();
  }

  flush(): Promise<void> {
    if (this.#writing !== null) return this.#writing;
    if (this.#pending === null) return Promise.resolve();
    this.#writing = (async () => {
      while (this.#pending !== null) {
        const next = this.#pending;
        this.#pending = null;
        try {
          await this.store.save(this.network, this.agentId, next, this.now());
          this.#lastSaved = JSON.stringify(next);
        } catch (err) {
          this.#pending ??= next;
          this.onError(err);
          return;
        }
      }
    })().finally(() => {
      this.#writing = null;
    });
    return this.#writing;
  }
}

/* ------------------------------ Postgres ------------------------------ */

type AnyPgJsDb = PostgresJsDatabase<Record<string, never>>;

export class DrizzleAgentStateStore implements AgentStateStore {
  constructor(private readonly db: AnyPgJsDb) {}

  async load(network: NetworkName, agentId: number): Promise<PersistedAgentState | null> {
    const rows = await this.db
      .select({ state: agentRiskState.state })
      .from(agentRiskState)
      .where(and(eq(agentRiskState.network, network), eq(agentRiskState.agentId, agentId)))
      .limit(1);
    // A row that does not parse is a hard error: guessing would risk clearing a stop.
    return rows[0] === undefined ? null : PersistedAgentState.parse(rows[0].state);
  }

  async save(network: NetworkName, agentId: number, state: PersistedAgentState, at: number): Promise<void> {
    await this.db
      .insert(agentRiskState)
      .values({ network, agentId, state, updatedAt: new Date(at) })
      .onConflictDoUpdate({ target: [agentRiskState.network, agentRiskState.agentId], set: { state, updatedAt: new Date(at) } });
  }
}

/** Nonces shared with the API's admin path (L-7), so a restart cannot reopen a replay window. */
export class DrizzleNonceStore implements NonceStore {
  constructor(private readonly db: AnyPgJsDb) {}

  async consume(nonce: string, _expiresAt: number, nowMs: number): Promise<boolean> {
    const rows = await this.db.insert(adminNonces).values({ nonce, usedAt: new Date(nowMs) }).onConflictDoNothing().returning({ nonce: adminNonces.nonce });
    return rows.length === 1;
  }
}

export interface KillCommandRow {
  readonly id: string;
  readonly targetAgentId: number | null;
  readonly closePositions: boolean;
  readonly requestedAt: number;
}

export interface KillCommandFeed {
  /** Commands for this agent (or all agents) that this agent has not acknowledged yet. */
  pending(network: NetworkName, agentId: number): Promise<KillCommandRow[]>;
}

/**
 * Reads `kill_commands` (migration 0003, written by apps/api after verifying the owner signature).
 * An agent acknowledges a command with a guard_events row (reason kill_switch_api,
 * observed.killCommandId), so unacknowledged commands are picked up even after downtime.
 */
export class DrizzleKillCommandFeed implements KillCommandFeed {
  constructor(private readonly db: AnyPgJsDb) {}

  async pending(network: NetworkName, agentId: number): Promise<KillCommandRow[]> {
    const rows = await this.db
      .select({ id: killCommands.id, targetAgentId: killCommands.targetAgentId, closePositions: killCommands.closePositions, requestedAt: killCommands.requestedAt })
      .from(killCommands)
      .where(
        and(
          eq(killCommands.network, network),
          dsql`(${killCommands.targetAgentId} IS NULL OR ${killCommands.targetAgentId} = ${agentId})`,
          dsql`NOT EXISTS (SELECT 1 FROM ${guardEvents} WHERE ${guardEvents.agentId} = ${agentId} AND ${guardEvents.network} = ${network}
               AND ${guardEvents.reason} = 'kill_switch_api' AND ${guardEvents.observed} ->> 'killCommandId' = ${killCommands.id})`,
        ),
      )
      .orderBy(killCommands.requestedAt)
      .limit(50);
    return rows.map((r) => ({ id: r.id, targetAgentId: r.targetAgentId, closePositions: r.closePositions, requestedAt: r.requestedAt.getTime() }));
  }
}

export interface HeartbeatSink {
  write(network: NetworkName, service: string, at: number, detail: Record<string, unknown>): Promise<void>;
}

export class DrizzleHeartbeatSink implements HeartbeatSink {
  constructor(private readonly db: AnyPgJsDb) {}

  async write(network: NetworkName, service: string, at: number, detail: Record<string, unknown>): Promise<void> {
    await this.db
      .insert(heartbeats)
      .values({ network, service, at: new Date(at), detail })
      .onConflictDoUpdate({ target: [heartbeats.network, heartbeats.service], set: { at: new Date(at), detail } });
  }
}
