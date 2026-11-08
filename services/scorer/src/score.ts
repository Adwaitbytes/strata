/**
 * Score formula (PRD 10.3), implemented exactly:
 *
 *   liquidity = 0.35 * norm(depthUsd@25bps) + 0.25 * norm(uptimeBps) + 0.20 * norm(1/quotedSpreadBps) + 0.20 * norm(bookShare)
 *   quality   = clamp(0.5 + norm(markout60s) - penalty(maxDrawdown), 0, 1)
 *   score     = round(10000 * liquidity * (0.7 + 0.3 * quality))
 *
 * `norm` is min-max over the active (unflagged) agents of the epoch. When the spread of values is
 * below a per-metric floor (a single agent, or a tie), min-max is undefined, so:
 * - liquidity metrics give 1 when the value is at least the floor (the agent provided it) and 0 otherwise;
 * - markout gives the neutral 0.5.
 * Any flag disqualifies the epoch: score 0, and the agent is left out of the normalization range.
 */
import type { AgentMetrics } from "./metrics.js";

export interface ScoreParams {
  /** Drawdown (USD) at which the penalty reaches its 0.5 cap. Default matches D6 max season drawdown. */
  drawdownScaleUsd: number;
}

export const DEFAULT_SCORE_PARAMS: ScoreParams = { drawdownScaleUsd: 150 };

export const WEIGHTS = { depth: 0.35, uptime: 0.25, invSpread: 0.2, bookShare: 0.2 } as const;

/** Spread is floored here before inversion, so a zero-width quote cannot divide by zero. */
export const MIN_SPREAD_BPS = 0.1;

export interface NormRule {
  /** Smallest range treated as a real spread of values, and the smallest meaningful value under "presence". */
  floor: number;
  degenerate: "presence" | "neutral";
}

export const NORM_RULES = {
  depth: { floor: 1, degenerate: "presence" },
  uptime: { floor: 1, degenerate: "presence" },
  invSpread: { floor: 1e-6, degenerate: "presence" },
  bookShare: { floor: 1e-6, degenerate: "presence" },
  markout: { floor: 0.01, degenerate: "neutral" },
} as const satisfies Record<string, NormRule>;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export function minMaxNorm(values: readonly number[], x: number, rule: NormRule): number {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  if (values.length > 0 && hi - lo >= rule.floor) return clamp((x - lo) / (hi - lo), 0, 1);
  if (rule.degenerate === "neutral") return 0.5;
  return x >= rule.floor ? 1 : 0;
}

/** Linear in drawdown, reaching 0.5 at `scaleUsd` and capped there. */
export function penalty(maxDrawdownUsd: number, scaleUsd: number): number {
  return 0.5 * clamp(maxDrawdownUsd / scaleUsd, 0, 1);
}

export function inverseSpread(m: AgentMetrics): number {
  return m.twoSidedSamples > 0 ? 1 / Math.max(m.quotedSpreadBps, MIN_SPREAD_BPS) : 0;
}

export interface ScoreEntry {
  agentId: number;
  flags: number;
  metrics: AgentMetrics;
}

export interface ScoredAgent {
  agentId: number;
  flags: number;
  score: number;
  liquidity: number;
  quality: number;
  /** Raw inputs to norm, kept for the published breakdown. */
  components: { depth: number; uptime: number; invSpread: number; bookShare: number; markout: number; penalty: number };
  norms: { depth: number; uptime: number; invSpread: number; bookShare: number; markout: number };
}

export function scoreAgents(entries: readonly ScoreEntry[], params: ScoreParams): ScoredAgent[] {
  const raw = entries.map((e) => ({
    entry: e,
    components: {
      depth: e.metrics.depthUsd25,
      uptime: e.metrics.uptimeBps,
      invSpread: inverseSpread(e.metrics),
      bookShare: e.metrics.bookShare,
      markout: e.metrics.markout60s,
      penalty: penalty(e.metrics.maxDrawdownUsd, params.drawdownScaleUsd),
    },
  }));
  const active = raw.filter((r) => r.entry.flags === 0);
  const range = (k: keyof typeof NORM_RULES) => active.map((r) => r.components[k]);
  const ranges = {
    depth: range("depth"),
    uptime: range("uptime"),
    invSpread: range("invSpread"),
    bookShare: range("bookShare"),
    markout: range("markout"),
  };

  return raw.map(({ entry, components }) => {
    const norms = {
      depth: minMaxNorm(ranges.depth, components.depth, NORM_RULES.depth),
      uptime: minMaxNorm(ranges.uptime, components.uptime, NORM_RULES.uptime),
      invSpread: minMaxNorm(ranges.invSpread, components.invSpread, NORM_RULES.invSpread),
      bookShare: minMaxNorm(ranges.bookShare, components.bookShare, NORM_RULES.bookShare),
      markout: minMaxNorm(ranges.markout, components.markout, NORM_RULES.markout),
    };
    const liquidity =
      WEIGHTS.depth * norms.depth + WEIGHTS.uptime * norms.uptime + WEIGHTS.invSpread * norms.invSpread + WEIGHTS.bookShare * norms.bookShare;
    const quality = clamp(0.5 + norms.markout - components.penalty, 0, 1);
    const score = entry.flags === 0 ? clamp(Math.round(10_000 * liquidity * (0.7 + 0.3 * quality)), 0, 10_000) : 0;
    return { agentId: entry.agentId, flags: entry.flags, score, liquidity, quality, components, norms };
  });
}
