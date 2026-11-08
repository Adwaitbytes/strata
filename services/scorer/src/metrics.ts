/**
 * Epoch metrics (PRD 10.2), computed on a fixed 5-second sample grid.
 *
 * Samples sit at startMs + k * 5 s for every k with sample < endMs. Because the grid is uniform,
 * a time-weighted average equals the plain mean over samples. A sample is valid only when the
 * market has a book snapshot younger than BOOK_STALENESS_MS with a mid price; invalid samples are
 * left out of every average and lower the coverage figure that drives the DATA_GAP flag.
 *
 * Full definitions and the cross-market aggregation are documented in docs/SCORING.md.
 */
import type { EpochMetrics } from "@strata/sdk";
import type { BookSample, EpochWindow, FillRecord, MarketParams, OrderRecord } from "./model.js";

export const SAMPLE_INTERVAL_MS = 5_000;
/** Orders that live less than this are flicker quotes and never count (PRD 10.5). */
export const FLICKER_MS = 1_000;
export const DEPTH_BAND_BPS = 25;
export const MARKOUT_HORIZON_MS = 60_000;
/** A snapshot this old or older does not describe the book at the sample time. */
export const BOOK_STALENESS_MS = 15_000;

const BPS = 10_000;

export function sampleTimes(window: EpochWindow): number[] {
  const out: number[] = [];
  for (let t = window.startMs; t < window.endMs; t += SAMPLE_INTERVAL_MS) out.push(t);
  return out;
}

/** Latest snapshot at or before `t` that is younger than the staleness limit and has a mid. Book must be sorted by `at`. */
export function bookAt(book: readonly BookSample[], t: number): BookSample | null {
  let lo = 0;
  let hi = book.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (book[mid]!.at <= t) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (found < 0) return null;
  const snap = book[found]!;
  if (t - snap.at >= BOOK_STALENESS_MS || snap.mid === null || !(snap.mid > 0)) return null;
  return snap;
}

export function isFlicker(o: OrderRecord): boolean {
  return o.cancelledAt !== null && o.cancelledAt - o.postedAt < FLICKER_MS;
}

export interface MarketMetrics {
  marketId: string;
  totalSamples: number;
  validSamples: number;
  twoSidedSamples: number;
  uptimeSamples: number;
  /** Mean agent spread over two-sided samples; null when the agent was never two-sided. */
  quotedSpreadBps: number | null;
  /** Mean USD notional within 25 bps of mid over valid samples. */
  depthUsd25: number;
  /** Mean of agent depth / total book depth (within 25 bps) over valid samples. */
  bookShare: number;
  /** Sum over eligible fills of side * (mid at t+60 s minus fill price) * quantity, USD. */
  markoutUsd: number;
  markoutNotionalUsd: number;
  markoutFills: number;
  /** Mean public book spread over the samples where this agent was two-sided. */
  marketSpreadWithAgentBps: number | null;
  /** Baseline spread minus marketSpreadWithAgentBps; positive means tighter than baseline. */
  spreadImprovementBps: number | null;
}

export interface MarketMetricsInput {
  window: EpochWindow;
  market: MarketParams;
  /** Public book for the market, sorted by `at`, covering the window plus the markout horizon. */
  book: readonly BookSample[];
  /** This agent's orders in this market. */
  orders: readonly OrderRecord[];
  /** Every fill of this agent in this market up to the window end (used for remaining size and markout). */
  fills: readonly FillRecord[];
  /** Fill ids excluded from markout by anti-gaming (own-order and wash fills). */
  excludedFillIds: ReadonlySet<string>;
  /** Mean spread over this market's BASELINE windows, null when no baseline exists. */
  baselineSpreadBps: number | null;
}

export function computeMarketMetrics(input: MarketMetricsInput): MarketMetrics {
  const { window, market, book, excludedFillIds } = input;
  const samples = sampleTimes(window);

  const orders = input.orders.filter((o) => !isFlicker(o)).slice().sort((a, b) => a.postedAt - b.postedAt);
  const fillsByOrder = new Map<string, FillRecord[]>();
  for (const f of [...input.fills].sort((a, b) => a.executedAt - b.executedAt)) {
    const list = fillsByOrder.get(f.orderHash);
    if (list) list.push(f);
    else fillsByOrder.set(f.orderHash, [f]);
  }
  const remainingAt = (o: OrderRecord, t: number): number => {
    let filled = 0;
    for (const f of fillsByOrder.get(o.orderHash) ?? []) {
      if (f.executedAt > t) break;
      filled += f.quantity;
    }
    return Math.max(0, o.quantity - filled);
  };

  let validSamples = 0;
  let twoSidedSamples = 0;
  let uptimeSamples = 0;
  let spreadSum = 0;
  let depthSum = 0;
  let shareSum = 0;
  let marketSpreadSum = 0;
  let marketSpreadCount = 0;

  // Sweep: `next` walks orders by post time, `active` holds orders posted at or before the sample.
  let next = 0;
  let active: OrderRecord[] = [];
  for (const t of samples) {
    while (next < orders.length && orders[next]!.postedAt <= t) active.push(orders[next++]!);
    active = active.filter((o) => o.cancelledAt === null || o.cancelledAt > t);

    const snap = bookAt(book, t);
    if (!snap) continue;
    const mid = snap.mid!;
    validSamples++;

    let bestBid = -Infinity;
    let bestAsk = Infinity;
    let depth = 0;
    for (const o of active) {
      const remaining = remainingAt(o, t);
      if (remaining <= 0) continue;
      if (o.side === "buy") bestBid = Math.max(bestBid, o.price);
      else bestAsk = Math.min(bestAsk, o.price);
      if ((Math.abs(o.price - mid) / mid) * BPS <= DEPTH_BAND_BPS) depth += o.price * remaining;
    }
    depthSum += depth;
    if (snap.depthUsd25 > 0) shareSum += Math.min(1, depth / snap.depthUsd25);

    if (bestBid > -Infinity && bestAsk < Infinity) {
      const spread = Math.max(0, ((bestAsk - bestBid) / mid) * BPS);
      twoSidedSamples++;
      spreadSum += spread;
      if (spread <= market.maxSpreadBps) uptimeSamples++;
      if (snap.spreadBps !== null) {
        marketSpreadSum += snap.spreadBps;
        marketSpreadCount++;
      }
    }
  }

  let markoutUsd = 0;
  let markoutNotionalUsd = 0;
  let markoutFills = 0;
  for (const f of input.fills) {
    if (f.executedAt < window.startMs || f.executedAt >= window.endMs) continue;
    if (excludedFillIds.has(f.id)) continue;
    const later = bookAt(book, f.executedAt + MARKOUT_HORIZON_MS);
    if (!later) continue;
    const sign = f.side === "buy" ? 1 : -1;
    markoutUsd += sign * (later.mid! - f.price) * f.quantity;
    markoutNotionalUsd += f.price * f.quantity;
    markoutFills++;
  }

  const marketSpreadWithAgentBps = marketSpreadCount > 0 ? marketSpreadSum / marketSpreadCount : null;
  return {
    marketId: market.marketId,
    totalSamples: samples.length,
    validSamples,
    twoSidedSamples,
    uptimeSamples,
    quotedSpreadBps: twoSidedSamples > 0 ? spreadSum / twoSidedSamples : null,
    depthUsd25: validSamples > 0 ? depthSum / validSamples : 0,
    bookShare: validSamples > 0 ? shareSum / validSamples : 0,
    markoutUsd,
    markoutNotionalUsd,
    markoutFills,
    marketSpreadWithAgentBps,
    spreadImprovementBps:
      marketSpreadWithAgentBps !== null && input.baselineSpreadBps !== null ? input.baselineSpreadBps - marketSpreadWithAgentBps : null,
  };
}

/** Published metrics plus the extra counts the scorer needs for normalization and flags. */
export interface AgentMetrics extends EpochMetrics {
  twoSidedSamples: number;
  totalSamples: number;
  /** validSamples / totalSamples across the agent's markets, 0 when there are none. */
  coverage: number;
}

/**
 * Combines per-market metrics into one record per agent:
 * depth is summed, spread and spread improvement are weighted by two-sided samples,
 * uptime and book share are weighted by valid samples, markout is pooled by notional (in bps).
 */
export function aggregateAgentMetrics(
  markets: readonly MarketMetrics[],
  pnl: { pnlUsd: number; maxDrawdownUsd: number },
): AgentMetrics {
  let valid = 0;
  let total = 0;
  let twoSided = 0;
  let uptime = 0;
  let depth = 0;
  let shareWeighted = 0;
  let spreadWeighted = 0;
  let improvementWeighted = 0;
  let improvementWeight = 0;
  let markoutUsd = 0;
  let markoutNotional = 0;
  for (const m of markets) {
    valid += m.validSamples;
    total += m.totalSamples;
    twoSided += m.twoSidedSamples;
    uptime += m.uptimeSamples;
    depth += m.depthUsd25;
    shareWeighted += m.bookShare * m.validSamples;
    if (m.quotedSpreadBps !== null) spreadWeighted += m.quotedSpreadBps * m.twoSidedSamples;
    if (m.spreadImprovementBps !== null) {
      improvementWeighted += m.spreadImprovementBps * m.twoSidedSamples;
      improvementWeight += m.twoSidedSamples;
    }
    markoutUsd += m.markoutUsd;
    markoutNotional += m.markoutNotionalUsd;
  }
  return {
    quotedSpreadBps: twoSided > 0 ? spreadWeighted / twoSided : 0,
    depthUsd25: depth,
    uptimeBps: valid > 0 ? Math.round((BPS * uptime) / valid) : 0,
    bookShare: valid > 0 ? shareWeighted / valid : 0,
    markout60s: markoutNotional > 0 ? (markoutUsd / markoutNotional) * BPS : 0,
    pnlUsd: pnl.pnlUsd,
    maxDrawdownUsd: pnl.maxDrawdownUsd,
    spreadImprovementBps: improvementWeight > 0 ? improvementWeighted / improvementWeight : 0,
    samples: valid,
    twoSidedSamples: twoSided,
    totalSamples: total,
    coverage: total > 0 ? valid / total : 0,
  };
}
