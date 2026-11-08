/**
 * Oracle Guard (PRD 9.4, the Ostium lesson). Stateful but pure: the caller passes state in and
 * stores the returned state. All time comparisons use CHAIN time, never the local clock.
 *
 * HALT when any check fails:
 * - unusable data (non-positive or non-finite price, missing timestamps)
 * - report newer than chainTime + maxFutureSkewSec (future-dated)
 * - report older than maxOracleAgeSec
 * - an independent reference disagrees beyond maxSourceDevBps
 * - a jump beyond maxJumpBps in one cycle that the book does not confirm
 * - oracle vs book mid beyond maxOracleBookDevBps for oracleBookDevCycles consecutive cycles
 * A halt is held for oracleHaltHoldSec of chain time, then a `resume` decision is emitted.
 */
import type { GuardReason } from "@strata/sdk";
import type { GuardDecision } from "./decisions.js";
import type { RiskParams } from "./params.js";

export interface OraclePrice {
  readonly price: number;
  readonly timestampMs: number;
}

export interface OracleObservation {
  readonly oracle: OraclePrice;
  readonly reference: OraclePrice | null;
  readonly chainTimeMs: number;
  /** Host wall clock (NTP), used only to detect a node whose chain time lags (M-3). */
  readonly wallClockMs: number;
  /** Book mid from the external book, null when the book is one-sided or empty. */
  readonly bookMid: number | null;
}

export interface OracleGuardState {
  readonly consecutiveDevCycles: number;
  readonly lastOraclePrice: number | null;
  readonly lastBookMid: number | null;
  readonly haltedUntilMs: number | null;
  readonly haltReason: GuardReason | null;
}

export const INITIAL_ORACLE_STATE: OracleGuardState = {
  consecutiveDevCycles: 0,
  lastOraclePrice: null,
  lastBookMid: null,
  haltedUntilMs: null,
  haltReason: null,
};

export interface OracleGuardResult {
  readonly action: "ok" | "halt" | "resume";
  /** 2 when the reference policy widens spreads, else 1. */
  readonly spreadMultiplier: number;
  readonly decisions: readonly GuardDecision[];
  readonly state: OracleGuardState;
}

const BPS = 1e4;
const round = (v: number, dp = 2): number => Math.round(v * 10 ** dp) / 10 ** dp;
const bpsBetween = (a: number, b: number): number => ((a - b) / b) * BPS;
const isPrice = (v: number): boolean => Number.isFinite(v) && v > 0;

function halt(reason: GuardReason, detail: string, observed: GuardDecision["observed"]): GuardDecision {
  return { guard: "oracle", action: "halt", reason, detail, observed };
}

export function evaluateOracle(obs: OracleObservation, state: OracleGuardState, params: RiskParams): OracleGuardResult {
  const now = obs.chainTimeMs;
  const { price, timestampMs } = obs.oracle;
  const failures: GuardDecision[] = [];

  if (!isPrice(price) || !Number.isFinite(timestampMs) || !Number.isFinite(now) || !Number.isFinite(obs.wallClockMs)) {
    failures.push(
      halt("data_unavailable", "Oracle price, oracle timestamp, chain time or host clock is missing or invalid.", {
        price: Number.isFinite(price) ? price : "invalid",
        timestampMs: Number.isFinite(timestampMs) ? timestampMs : "invalid",
        chainTimeMs: Number.isFinite(now) ? now : "invalid",
        wallClockMs: Number.isFinite(obs.wallClockMs) ? obs.wallClockMs : "invalid",
      }),
    );
    return finish(failures, [], state, obs, params, { devCycles: state.consecutiveDevCycles, keepLast: true });
  }

  const chainLagSec = (obs.wallClockMs - now) / 1_000;
  if (chainLagSec > params.maxChainLagSec) {
    failures.push(
      halt("data_unavailable", `Chain time lags the host clock by ${round(chainLagSec)} s, limit is ${params.maxChainLagSec} s; the node may be stale.`, {
        chainLagSec: round(chainLagSec, 3),
        limitSec: params.maxChainLagSec,
      }),
    );
  }

  const aheadSec = (timestampMs - now) / 1_000;
  if (aheadSec > params.maxFutureSkewSec) {
    failures.push(
      halt(
        "oracle_future_timestamp",
        `Oracle report is dated ${round(aheadSec)} s ahead of chain time, limit is ${params.maxFutureSkewSec} s.`,
        { aheadSec: round(aheadSec, 3), limitSec: params.maxFutureSkewSec },
      ),
    );
  }

  const ageSec = (now - timestampMs) / 1_000;
  if (ageSec > params.maxOracleAgeSec) {
    failures.push(
      halt("oracle_stale", `Oracle report is ${round(ageSec)} s old, limit is ${params.maxOracleAgeSec} s.`, {
        oracleAgeSec: round(ageSec, 3),
        limitSec: params.maxOracleAgeSec,
      }),
    );
  }

  const ref = obs.reference;
  const refUsable =
    ref !== null &&
    isPrice(ref.price) &&
    Number.isFinite(ref.timestampMs) &&
    (now - ref.timestampMs) / 1_000 <= params.maxOracleAgeSec &&
    (ref.timestampMs - now) / 1_000 <= params.maxFutureSkewSec;
  const warnings: GuardDecision[] = [];
  if (!refUsable && params.referencePolicy !== "none") {
    const detail = "Reference price is missing, stale or future-dated, so the two-source check cannot run.";
    const observed = { referencePolicy: params.referencePolicy, referencePresent: ref !== null };
    if (params.referencePolicy === "halt") failures.push(halt("oracle_source_divergence", detail, observed));
    else warnings.push({ guard: "oracle", action: "widen", reason: "oracle_source_divergence", detail: `${detail} Spreads widened.`, observed });
  }
  if (refUsable && ref !== null) {
    const divergenceBps = Math.abs(bpsBetween(ref.price, price));
    if (divergenceBps > params.maxSourceDevBps) {
      failures.push(
        halt(
          "oracle_source_divergence",
          `Oracle and reference prices differ by ${round(divergenceBps, 1)} bps, limit is ${params.maxSourceDevBps} bps.`,
          { divergenceBps, limitBps: params.maxSourceDevBps, oraclePrice: price, referencePrice: ref.price },
        ),
      );
    }
  }

  if (state.lastOraclePrice !== null) {
    const oracleMoveBps = bpsBetween(price, state.lastOraclePrice);
    const bookMoveBps =
      obs.bookMid !== null && state.lastBookMid !== null ? bpsBetween(obs.bookMid, state.lastBookMid) : 0;
    const unexplainedBps = Math.abs(oracleMoveBps - bookMoveBps);
    if (Math.abs(oracleMoveBps) > params.maxJumpBps && unexplainedBps > params.maxJumpBps) {
      failures.push(
        halt(
          "oracle_jump",
          `Oracle moved ${round(oracleMoveBps, 1)} bps in one cycle while the book moved ${round(bookMoveBps, 1)} bps.`,
          { oracleMoveBps: round(oracleMoveBps, 3), bookMoveBps: round(bookMoveBps, 3), limitBps: params.maxJumpBps },
        ),
      );
    }
  }

  let devCycles = state.consecutiveDevCycles;
  if (obs.bookMid !== null && isPrice(obs.bookMid)) {
    const devBps = Math.abs(bpsBetween(obs.bookMid, price));
    devCycles = devBps > params.maxOracleBookDevBps ? devCycles + 1 : 0;
    if (devCycles >= params.oracleBookDevCycles) {
      failures.push(
        halt(
          "oracle_book_deviation",
          `Oracle is ${round(devBps, 1)} bps from the book mid for ${devCycles} consecutive cycles, limit is ${params.maxOracleBookDevBps} bps.`,
          { deviationBps: round(devBps, 3), consecutiveCycles: devCycles, limitBps: params.maxOracleBookDevBps },
        ),
      );
    }
  }

  return finish(failures, warnings, state, obs, params, { devCycles, keepLast: false });
}

function finish(
  failures: GuardDecision[],
  warnings: GuardDecision[],
  state: OracleGuardState,
  obs: OracleObservation,
  params: RiskParams,
  opts: { devCycles: number; keepLast: boolean },
): OracleGuardResult {
  const now = obs.chainTimeMs;
  const base: OracleGuardState = {
    consecutiveDevCycles: opts.devCycles,
    lastOraclePrice: opts.keepLast ? state.lastOraclePrice : obs.oracle.price,
    lastBookMid: opts.keepLast ? state.lastBookMid : obs.bookMid ?? state.lastBookMid,
    haltedUntilMs: state.haltedUntilMs,
    haltReason: state.haltReason,
  };

  if (failures.length > 0) {
    const holdFrom = Number.isFinite(now) ? now : (state.haltedUntilMs ?? 0);
    return {
      action: "halt",
      spreadMultiplier: 1,
      decisions: failures,
      state: { ...base, haltedUntilMs: holdFrom + params.oracleHaltHoldSec * 1_000, haltReason: failures[0]!.reason },
    };
  }

  if (state.haltReason !== null && state.haltedUntilMs !== null) {
    if (now < state.haltedUntilMs) {
      const remaining = (state.haltedUntilMs - now) / 1_000;
      return {
        action: "halt",
        spreadMultiplier: 1,
        decisions: [
          halt(state.haltReason, `Oracle checks pass again; holding the halt for ${round(remaining)} s more.`, {
            holdRemainingSec: round(remaining, 3),
          }),
        ],
        state: base,
      };
    }
    return {
      action: "resume",
      spreadMultiplier: warnings.length > 0 ? 2 : 1,
      decisions: [
        ...warnings,
        {
          guard: "oracle",
          action: "resume",
          reason: state.haltReason,
          detail: "Oracle checks have passed for the full hold period; quoting resumes.",
          observed: { heldSec: params.oracleHaltHoldSec },
        },
      ],
      state: { ...base, haltedUntilMs: null, haltReason: null },
    };
  }

  return { action: "ok", spreadMultiplier: warnings.length > 0 ? 2 : 1, decisions: warnings, state: base };
}
