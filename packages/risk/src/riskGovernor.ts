/**
 * Risk Governor (PRD 9.6). Stateful but pure: state in, state out.
 *
 * - Gross notional above the limit: every market goes reduce-only.
 * - Net notional on one market above the limit: that market goes reduce-only.
 * - Daily loss (from UTC day-start equity) at the limit: halt and close for the rest of the UTC day.
 * - Drawdown from peak equity at the limit: halt and close for the season; only a human resets it.
 * - Order rate: rolling one-minute order budget.
 * - Margin ratio below minMarginRatio: flatten markets with positions; below criticalMarginRatio:
 *   close positions with reduce-only IOC orders.
 */
import { MAINNET_CAPITAL_CAP_USD } from "@strata/config";
import type { NetworkName } from "@strata/sdk";
import type { GuardDecision } from "./decisions.js";
import type { RiskParams } from "./params.js";

export interface PositionExposure {
  readonly marketId: string;
  /** Signed base quantity, positive = long. */
  readonly quantityBase: number;
  readonly markPrice: number;
}

export interface RiskInput {
  readonly nowMs: number;
  readonly equityUsd: number;
  readonly positions: readonly PositionExposure[];
  readonly marginRatio: number | null;
}

export interface RiskState {
  readonly dayKey: string | null;
  readonly dayStartEquityUsd: number | null;
  readonly peakEquityUsd: number | null;
  readonly stoppedForDay: boolean;
  readonly stoppedForSeason: boolean;
  readonly orderTimesMs: readonly number[];
}

export const INITIAL_RISK_STATE: RiskState = {
  dayKey: null,
  dayStartEquityUsd: null,
  peakEquityUsd: null,
  stoppedForDay: false,
  stoppedForSeason: false,
  orderTimesMs: [],
};

/** Per-market instruction for the quoting loop. */
export type MarketRiskMode = "normal" | "reduce_only" | "flatten" | "halt";

export interface ScopedDecision {
  /** null = applies to the whole agent. */
  readonly marketId: string | null;
  readonly decision: GuardDecision;
}

export interface RiskResult {
  readonly haltAll: boolean;
  /** Close positions with reduce-only IOC orders now. */
  readonly closePositions: boolean;
  readonly orderBudget: number;
  readonly markets: Readonly<Record<string, MarketRiskMode>>;
  readonly decisions: readonly ScopedDecision[];
}

const ORDER_WINDOW_MS = 60_000;
const round2 = (v: number): number => Math.round(v * 100) / 100;

function risk(action: GuardDecision["action"], reason: GuardDecision["reason"], detail: string, observed: GuardDecision["observed"]): GuardDecision {
  return { guard: "risk", action, reason, detail, observed };
}

const RANK: Readonly<Record<MarketRiskMode, number>> = { normal: 0, reduce_only: 1, flatten: 2, halt: 3 };
function worse(a: MarketRiskMode, b: MarketRiskMode): MarketRiskMode {
  return RANK[b] > RANK[a] ? b : a;
}

export function evaluateRisk(input: RiskInput, state: RiskState, params: RiskParams): { result: RiskResult; state: RiskState } {
  const decisions: ScopedDecision[] = [];
  const markets: Record<string, MarketRiskMode> = {};
  for (const p of input.positions) markets[p.marketId] = "normal";
  const orderTimesMs = state.orderTimesMs.filter((t) => input.nowMs - t < ORDER_WINDOW_MS);
  const orderBudget = Math.max(0, params.maxOrdersPerMinute - orderTimesMs.length);
  const haltEverything = (): Record<string, MarketRiskMode> => Object.fromEntries(Object.keys(markets).map((k) => [k, "halt" as const]));

  // Fail closed (L-2): a NaN compares false against every limit, which would silently disable it.
  const badPosition = input.positions.find((p) => !Number.isFinite(p.quantityBase) || !Number.isFinite(p.markPrice));
  const hasPosition = input.positions.some((p) => p.quantityBase !== 0);
  const marginUnknown = hasPosition && (input.marginRatio === null || !Number.isFinite(input.marginRatio));
  if (!Number.isFinite(input.equityUsd) || badPosition !== undefined || marginUnknown) {
    const detail = !Number.isFinite(input.equityUsd)
      ? "Account equity is unavailable; quoting is halted."
      : badPosition !== undefined
        ? "A position size or mark price is unavailable; quoting is halted."
        : "Margin ratio is unavailable while a position is open; quoting is halted.";
    decisions.push({
      marketId: badPosition?.marketId ?? null,
      decision: risk("halt", "data_unavailable", detail, {
        equityUsd: Number.isFinite(input.equityUsd) ? input.equityUsd : "invalid",
        marginRatio: input.marginRatio === null ? "missing" : Number.isFinite(input.marginRatio) ? input.marginRatio : "invalid",
      }),
    });
    return {
      result: { haltAll: true, closePositions: false, orderBudget, markets: haltEverything(), decisions },
      state: { ...state, orderTimesMs },
    };
  }

  const dayKey = new Date(input.nowMs).toISOString().slice(0, 10);
  const newDay = dayKey !== state.dayKey;
  const dayStart = newDay || state.dayStartEquityUsd === null ? input.equityUsd : state.dayStartEquityUsd;
  const peak = Math.max(state.peakEquityUsd ?? input.equityUsd, input.equityUsd);
  let stoppedForDay = newDay ? false : state.stoppedForDay;
  let stoppedForSeason = state.stoppedForSeason;

  const dailyLoss = dayStart - input.equityUsd;
  if (dailyLoss >= params.maxDailyLossUsd) {
    stoppedForDay = true;
    decisions.push({
      marketId: null,
      decision: risk("halt", "risk_daily_loss", `Daily loss of $${round2(dailyLoss)} reached the $${params.maxDailyLossUsd} limit; stopped for the day.`, {
        dailyLossUsd: round2(dailyLoss),
        limitUsd: params.maxDailyLossUsd,
      }),
    });
  }
  const drawdown = peak - input.equityUsd;
  if (drawdown >= params.maxDrawdownUsd) {
    stoppedForSeason = true;
    decisions.push({
      marketId: null,
      decision: risk(
        "halt",
        "risk_max_drawdown",
        `Drawdown of $${round2(drawdown)} from peak reached the $${params.maxDrawdownUsd} limit; stopped for the season pending human review.`,
        { drawdownUsd: round2(drawdown), limitUsd: params.maxDrawdownUsd, peakEquityUsd: round2(peak) },
      ),
    });
  }

  const nextState: RiskState = { dayKey, dayStartEquityUsd: dayStart, peakEquityUsd: peak, stoppedForDay, stoppedForSeason, orderTimesMs };

  if (stoppedForDay || stoppedForSeason) {
    if (decisions.length === 0) {
      const reason = stoppedForSeason ? "risk_max_drawdown" : "risk_daily_loss";
      decisions.push({ marketId: null, decision: risk("halt", reason, "Agent remains stopped by an earlier risk limit.", { stoppedForSeason, stoppedForDay }) });
    }
    return { result: { haltAll: true, closePositions: true, orderBudget, markets: haltEverything(), decisions }, state: nextState };
  }

  if (input.marginRatio !== null && input.marginRatio < params.criticalMarginRatio) {
    decisions.push({
      marketId: null,
      decision: risk("flatten", "risk_margin_ratio", `Margin ratio ${round2(input.marginRatio)} is below the critical ${params.criticalMarginRatio}; closing positions.`, {
        marginRatio: input.marginRatio,
        limit: params.criticalMarginRatio,
      }),
    });
    return { result: { haltAll: true, closePositions: true, orderBudget, markets: haltEverything(), decisions }, state: nextState };
  }

  const gross = input.positions.reduce((s, p) => s + Math.abs(p.quantityBase * p.markPrice), 0);
  if (gross > params.maxGrossNotionalUsd) {
    for (const k of Object.keys(markets)) markets[k] = worse(markets[k]!, "reduce_only");
    decisions.push({
      marketId: null,
      decision: risk("reduce", "risk_gross_notional", `Gross notional $${round2(gross)} is above the $${params.maxGrossNotionalUsd} limit; only reducing orders.`, {
        grossNotionalUsd: round2(gross),
        limitUsd: params.maxGrossNotionalUsd,
      }),
    });
  }

  for (const p of input.positions) {
    const net = Math.abs(p.quantityBase * p.markPrice);
    if (net > params.maxNetNotionalUsd) {
      markets[p.marketId] = worse(markets[p.marketId]!, "reduce_only");
      decisions.push({
        marketId: p.marketId,
        decision: risk("reduce", "risk_net_notional", `Net notional $${round2(net)} is above the $${params.maxNetNotionalUsd} limit; only reducing orders.`, {
          netNotionalUsd: round2(net),
          limitUsd: params.maxNetNotionalUsd,
        }),
      });
    }
  }

  if (input.marginRatio !== null && input.marginRatio < params.minMarginRatio) {
    for (const p of input.positions) markets[p.marketId] = worse(markets[p.marketId]!, p.quantityBase !== 0 ? "flatten" : "halt");
    decisions.push({
      marketId: null,
      decision: risk("reduce", "risk_margin_ratio", `Margin ratio ${round2(input.marginRatio)} is below ${params.minMarginRatio}; reducing positions.`, {
        marginRatio: input.marginRatio,
        limit: params.minMarginRatio,
      }),
    });
  }

  if (orderBudget === 0) {
    decisions.push({
      marketId: null,
      decision: risk("reduce", "risk_order_rate", `Order rate reached ${params.maxOrdersPerMinute} per minute; new orders wait for the window to roll.`, {
        ordersLastMinute: orderTimesMs.length,
        limit: params.maxOrdersPerMinute,
      }),
    });
  }

  return { result: { haltAll: false, closePositions: false, orderBudget, markets, decisions }, state: nextState };
}

export function recordOrders(state: RiskState, count: number, atMs: number): RiskState {
  if (count <= 0) return state;
  return { ...state, orderTimesMs: [...state.orderTimesMs, ...Array.from({ length: count }, () => atMs)] };
}

/** Human-only action after reviewing a season stop. Re-baselines the peak at the next evaluation. */
export function resetSeasonStop(state: RiskState): RiskState {
  return { ...state, stoppedForSeason: false, peakEquityUsd: null };
}

export interface AgentRiskConfig {
  readonly network: NetworkName;
  readonly capitalUsd: number;
  readonly params: RiskParams;
}

/**
 * D6: mainnet capital has a hard upper bound in code (`MAINNET_CAPITAL_CAP_USD`). Raising it needs
 * a code change and review, so a config above it is refused rather than clamped.
 */
export function assertMainnetCaps(cfg: AgentRiskConfig): void {
  if (cfg.network !== "mainnet") return;
  const cap = MAINNET_CAPITAL_CAP_USD;
  const problems: string[] = [];
  if (!(cfg.capitalUsd <= cap)) problems.push(`capitalUsd ${cfg.capitalUsd} exceeds MAINNET_CAPITAL_CAP_USD ${cap}`);
  for (const key of ["maxGrossNotionalUsd", "maxNetNotionalUsd", "inventoryCapUsd"] as const) {
    if (!(cfg.params[key] <= cap)) problems.push(`${key} ${cfg.params[key]} exceeds MAINNET_CAPITAL_CAP_USD ${cap}`);
  }
  for (const key of ["maxDailyLossUsd", "maxDrawdownUsd"] as const) {
    if (!(cfg.params[key] <= cfg.capitalUsd)) problems.push(`${key} ${cfg.params[key]} exceeds capitalUsd ${cfg.capitalUsd}`);
  }
  if (problems.length > 0) throw new Error(`Mainnet config refused: ${problems.join("; ")}`);
}
