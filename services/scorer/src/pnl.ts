/**
 * Season-to-date PnL and drawdown for one agent (PRD 10.2 `pnlUsd`, `maxDrawdown`).
 *
 * Cash accounting over every fill since the season start: a buy spends price * qty, a sell
 * receives it, fees are subtracted (rebates are negative fees), funding is added. Equity is cash
 * plus each open position marked to the latest mid. Equity is evaluated after every event, so
 * the drawdown is the largest peak-to-trough drop on that curve. The curve starts at 0.
 * Until a market has its first mark, its position is marked at the last fill price.
 */
import type { FillRecord, FundingRecord, MarkPoint } from "./model.js";

export interface PnlInput {
  fills: readonly FillRecord[];
  funding: readonly FundingRecord[];
  /** Mid marks per market, any order. */
  marks: ReadonlyMap<string, readonly MarkPoint[]>;
  /** Events strictly after this time are ignored. */
  untilMs: number;
}

export interface PnlResult {
  pnlUsd: number;
  maxDrawdownUsd: number;
}

type Event =
  | { at: number; order: 0; kind: "fill"; fill: FillRecord }
  | { at: number; order: 1; kind: "funding"; funding: FundingRecord }
  | { at: number; order: 2; kind: "mark"; marketId: string; mid: number };

export function computePnl(input: PnlInput): PnlResult {
  const events: Event[] = [];
  for (const fill of input.fills) if (fill.executedAt <= input.untilMs) events.push({ at: fill.executedAt, order: 0, kind: "fill", fill });
  for (const funding of input.funding) if (funding.at <= input.untilMs) events.push({ at: funding.at, order: 1, kind: "funding", funding });
  for (const [marketId, pts] of input.marks) {
    for (const p of pts) if (p.at <= input.untilMs) events.push({ at: p.at, order: 2, kind: "mark", marketId, mid: p.mid });
  }
  events.sort((a, b) => a.at - b.at || a.order - b.order);

  let cash = 0;
  const position = new Map<string, number>();
  const mark = new Map<string, number>();
  let peak = 0;
  let maxDrawdown = 0;
  let equity = 0;

  for (const e of events) {
    if (e.kind === "fill") {
      const f = e.fill;
      const sign = f.side === "buy" ? 1 : -1;
      cash -= sign * f.price * f.quantity + f.feeUsd;
      position.set(f.marketId, (position.get(f.marketId) ?? 0) + sign * f.quantity);
      if (!mark.has(f.marketId)) mark.set(f.marketId, f.price);
    } else if (e.kind === "funding") {
      cash += e.funding.amountUsd;
    } else {
      mark.set(e.marketId, e.mid);
    }
    equity = cash;
    for (const [m, qty] of position) equity += qty * (mark.get(m) ?? 0);
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
  }
  return { pnlUsd: equity, maxDrawdownUsd: maxDrawdown };
}
