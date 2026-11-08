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

/* ------------------------------------ 3D strata layout ------------------------------------ */

export interface StrataSlab {
  key: string;
  /** "book" is depth other makers provide; "strata" is depth STRATA agents add on top. */
  kind: "book" | "strata" | "neutral";
  /** Thickness in scene units. */
  thickness: number;
  label: string;
}

export interface StrataLayout {
  live: boolean;
  slabs: StrataSlab[];
  caption: string;
}

export const MAX_MARKET_LAYERS = 6;
const NEUTRAL_LAYERS = 7;
const NEUTRAL_THICKNESS = 0.12;
const MIN_MARKET = 0.09;
const MAX_MARKET = 0.42;
const MIN_STRATA = 0.018;

/**
 * Maps live per-market depth to slab thickness. Square-root scaling keeps a deep market from
 * flattening the rest; the STRATA share rides on top of each market as its own accent slab.
 */
export function buildStrataLayout(stats: HeroStatsResponse | null): StrataLayout {
  const layers = (stats?.layers ?? [])
    .filter((l) => l.depthUsd25 > 0)
    .sort((a, b) => b.depthUsd25 - a.depthUsd25)
    .slice(0, MAX_MARKET_LAYERS);

  if (!stats || layers.length === 0) {
    return {
      live: false,
      caption: stats ? "Neutral state: no market depth reported yet" : "Neutral state: live depth not available yet",
      slabs: Array.from({ length: NEUTRAL_LAYERS }, (_, i) => ({
        key: `neutral-${i}`,
        kind: "neutral" as const,
        thickness: NEUTRAL_THICKNESS,
        label: "No data",
      })),
    };
  }

  const maxRoot = Math.sqrt(Math.max(...layers.map((l) => l.depthUsd25)));
  const slabs: StrataSlab[] = [];
  for (const l of layers) {
    const total = MIN_MARKET + (MAX_MARKET - MIN_MARKET) * (Math.sqrt(l.depthUsd25) / maxRoot);
    const share = Math.min(1, l.strataDepthUsd25 / l.depthUsd25);
    const strata = share > 0 ? Math.max(MIN_STRATA, total * share) : 0;
    slabs.push({ key: `${l.marketId}-book`, kind: "book", thickness: Math.max(MIN_STRATA, total - strata), label: l.symbol });
    if (strata > 0) slabs.push({ key: `${l.marketId}-strata`, kind: "strata", thickness: strata, label: `${l.symbol} STRATA` });
  }
  return {
    live: true,
    caption: `Layer thickness is live depth within 25 bps per market, ${stats.network} ${stats.provenance}`,
    slabs,
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
