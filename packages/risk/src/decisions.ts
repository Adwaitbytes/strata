/**
 * Typed guard decisions. Every guard in this package returns `GuardDecision`s; the agent turns them
 * into `@strata/sdk` GuardEvents (shown on the Transparency page) with `toGuardEvent`.
 */
import type { GuardAction, GuardEvent, GuardName, GuardReason, NetworkName, Provenance } from "@strata/sdk";

export interface GuardDecision {
  readonly guard: GuardName;
  readonly action: GuardAction;
  readonly reason: GuardReason;
  /** One plain sentence, shown publicly. */
  readonly detail: string;
  readonly observed: Readonly<Record<string, number | string | boolean>>;
}

export interface GuardEventContext {
  readonly network: NetworkName;
  readonly provenance: Provenance;
  readonly agentId: number;
  readonly marketId: string | null;
  readonly id: string;
  readonly at: number;
}

export function toGuardEvent(decision: GuardDecision, ctx: GuardEventContext): GuardEvent {
  return {
    network: ctx.network,
    provenance: ctx.provenance,
    id: ctx.id,
    agentId: ctx.agentId,
    marketId: ctx.marketId,
    guard: decision.guard,
    action: decision.action,
    reason: decision.reason,
    detail: decision.detail,
    observed: { ...decision.observed },
    at: ctx.at,
  };
}

/** `resume` is informational: it ranks just above `ok` so any restrictive action wins. */
const SEVERITY: Readonly<Record<GuardAction, number>> = { ok: 0, resume: 1, widen: 2, reduce: 3, flatten: 4, halt: 5 };

export function mostSevere(actions: readonly GuardAction[]): GuardAction {
  let worst: GuardAction = "ok";
  for (const a of actions) if (SEVERITY[a] > SEVERITY[worst]) worst = a;
  return worst;
}
