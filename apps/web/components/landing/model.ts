import type { HeroStatsResponse, MarketsResponse, NetworkName, Provenance } from "@strata/sdk";
import { hasStrataDepth } from "@/lib/liquidity";

/**
 * Pure view-model for the Landing. No React, no fetch: everything here is unit tested.
 * Rule: a value we do not have renders as an explicit state, never as zero or a guess.
 */

export const NOT_LIVE = "Not live yet";
export const NOT_MEASURED = "Not measured yet";

export interface StatCell {
  id: "agents" | "markets" | "depth" | "spread";
  label: string;
  /** Formatted value, or null when there is nothing honest to show. */
  value: string | null;
  /** Numeric value for the roll animation; null when `value` is null or not numeric. */
  numeric: number | null;
  /** Unit set smaller after the value, e.g. "bps". */
  unit: string | null;
  emptyLabel: string;
  definition: string;
  source: string;
}

export interface StatStrip {
  live: boolean;
  network: NetworkName;
  provenance: Provenance | null;
  asOf: number | null;
  cells: StatCell[];
}

const usdCompact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});
const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const bps = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1, signDisplay: "exceptZero" });

export function formatUsdCompact(v: number): string {
  return usdCompact.format(v);
}

export function formatBpsNumber(v: number): string {
  return bps.format(v);
}

export function formatBps(v: number): string {
  return `${formatBpsNumber(v)} bps`;
}

export function buildStatStrip(stats: HeroStatsResponse | null, network: NetworkName): StatStrip {
  const source = stats ? `STRATA API /v1/stats, ${stats.network} ${stats.provenance}` : "STRATA API /v1/stats";
  const live = stats !== null;
  // Spread improvement is a STRATA effect only while STRATA agents have depth on the book.
  const strataQuoting = hasStrataDepth(stats);
  return {
    live,
    network: stats?.network ?? network,
    provenance: stats?.provenance ?? null,
    asOf: stats?.at ?? null,
    cells: [
      {
        id: "agents",
        label: "Agents live",
        value: live ? integer.format(stats.agentsLive) : null,
        numeric: live ? stats.agentsLive : null,
        unit: null,
        emptyLabel: NOT_LIVE,
        definition: "Enrolled agents with two-sided quotes on the book right now.",
        source,
      },
      {
        id: "markets",
        label: "Markets covered",
        value: live ? integer.format(stats.marketsCovered) : null,
        numeric: live ? stats.marketsCovered : null,
        unit: null,
        emptyLabel: NOT_LIVE,
        definition: "Injective markets where at least one STRATA agent is quoting.",
        source,
      },
      {
        id: "depth",
        label: "Depth added",
        value: live ? formatUsdCompact(stats.strataDepthUsd25) : null,
        numeric: live ? stats.strataDepthUsd25 : null,
        unit: null,
        emptyLabel: NOT_LIVE,
        definition: "USD notional of STRATA agent orders resting within 25 bps of mid, both sides, summed across markets.",
        source,
      },
      {
        id: "spread",
        label: "Spread improvement",
        value: live && strataQuoting && stats.spreadImprovementBps !== null ? formatBpsNumber(stats.spreadImprovementBps) : null,
        unit: "bps",
        numeric: live && strataQuoting ? stats.spreadImprovementBps : null,
        emptyLabel: live ? NOT_MEASURED : NOT_LIVE,
        definition:
          "Change in quoted spread against the BASELINE window recorded before agents went live. Positive means tighter.",
        source,
      },
    ],
  };
}

/* ------------------------------------ 3D survey terrain ------------------------------------ */

/**
 * One ridge per market in the hero terrain. The ridge runs along the price axis (bids on the
 * left of mid, asks on the right); its height is the market's live depth within 25 bps of mid,
 * and the STRATA share of that depth is drawn as a luminous stratum along the crest.
 */
export interface TerrainRidge {
  key: string;
  symbol: string;
  depthUsd25: number;
  strataDepthUsd25: number;
  /** Ridge height, 0 to 1, square-root scaled against the deepest market. */
  height: number;
  /** STRATA share of this market's depth, 0 to 1. */
  strataShare: number;
}

export interface TerrainField {
  live: boolean;
  ridges: TerrainRidge[];
  /** What the visitor is looking at, with network and provenance when live. */
  caption: string;
  network: NetworkName | null;
  provenance: Provenance | null;
}

export const MAX_RIDGES = 6;
const MIN_RIDGE_HEIGHT = 0.08;

/**
 * Maps live per-market depth to ridge heights. Square-root scaling keeps one deep market from
 * flattening the rest. Markets with no depth are left out: an empty book is not a ridge. With no
 * data, or no depth anywhere, the field is empty and the terrain renders as a labeled flat survey.
 */
export function buildTerrainField(stats: HeroStatsResponse | null): TerrainField {
  const layers = (stats?.layers ?? [])
    .filter((l) => l.depthUsd25 > 0)
    .sort((a, b) => b.depthUsd25 - a.depthUsd25)
    .slice(0, MAX_RIDGES);

  if (!stats || layers.length === 0) {
    return {
      live: false,
      ridges: [],
      caption: stats ? "Flat survey: no market reports depth yet" : "Flat survey: live depth not available yet",
      network: stats?.network ?? null,
      provenance: stats?.provenance ?? null,
    };
  }

  const maxRoot = Math.sqrt(Math.max(...layers.map((l) => l.depthUsd25)));
  const ridges = layers.map((l) => ({
    key: l.marketId,
    symbol: l.symbol,
    depthUsd25: l.depthUsd25,
    strataDepthUsd25: l.strataDepthUsd25,
    height: Math.max(MIN_RIDGE_HEIGHT, Math.sqrt(l.depthUsd25) / maxRoot),
    strataShare: Math.min(1, l.strataDepthUsd25 / l.depthUsd25),
  }));
  return {
    live: true,
    ridges,
    caption: "Ridge height is each market's depth within 25 bps of mid. Ridge profile is schematic.",
    network: stats.network,
    provenance: stats.provenance,
  };
}

/* ---------------------------------------- Proof ---------------------------------------- */

export interface ProofRow {
  marketId: string;
  symbol: string;
  baselineSpreadBps: number | null;
  nowSpreadBps: number | null;
  baselineDepthUsd: number;
  nowDepthUsd: number;
  baselineWindow: { start: number; end: number; samples: number };
  provenance: Provenance;
}

/**
 * Only markets with a closed BASELINE window and a current measurement in which STRATA agents
 * actually have depth can be shown as "before vs with STRATA". A current sample with no STRATA
 * depth is just another market reading, not an effect of STRATA (W7 honest-label rule).
 */
export function buildProofRows(markets: MarketsResponse | null): ProofRow[] {
  if (!markets) return [];
  const rows: ProofRow[] = [];
  for (const m of markets.markets) {
    if (!m.baseline || !m.now || m.baseline.samples === 0 || !hasStrataDepth(m.now)) continue;
    rows.push({
      marketId: m.market.marketId,
      symbol: m.market.symbol,
      baselineSpreadBps: m.baseline.spreadBps,
      nowSpreadBps: m.now.spreadBps,
      baselineDepthUsd: m.baseline.depthUsd25,
      nowDepthUsd: m.now.depthUsd25,
      baselineWindow: { start: m.baseline.windowStart, end: m.baseline.windowEnd, samples: m.baseline.samples },
      provenance: m.now.provenance,
    });
  }
  return rows.sort((a, b) => b.nowDepthUsd - a.nowDepthUsd).slice(0, 6);
}

/**
 * Core samples for the Proof scene when no before/after pair exists yet: each market's recorded
 * BASELINE window, real API data, with the "with STRATA" layer explicitly not measured.
 */
export interface BaselineCore {
  marketId: string;
  symbol: string;
  depthUsd: number;
  spreadBps: number | null;
  samples: number;
  windowStart: number;
  windowEnd: number;
}

export function buildBaselineCores(markets: MarketsResponse | null): BaselineCore[] {
  if (!markets) return [];
  return markets.markets
    .filter((m) => m.baseline && m.baseline.samples > 0)
    .map((m) => ({
      marketId: m.market.marketId,
      symbol: m.market.symbol,
      depthUsd: m.baseline?.depthUsd25 ?? 0,
      spreadBps: m.baseline?.spreadBps ?? null,
      samples: m.baseline?.samples ?? 0,
      windowStart: m.baseline?.windowStart ?? 0,
      windowEnd: m.baseline?.windowEnd ?? 0,
    }))
    .sort((a, b) => b.depthUsd - a.depthUsd)
    .slice(0, 6);
}
