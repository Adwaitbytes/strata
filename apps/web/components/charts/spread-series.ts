import type { UTCTimestamp } from "lightweight-charts";

export interface SpreadPoint {
  time: UTCTimestamp;
  value: number;
  baseline: boolean;
}

export interface SpreadSeries {
  baseline: SpreadPoint[];
  live: SpreadPoint[];
}

/** Lightweight Charts asserts strictly ascending times per series; keep the last sample per time. */
function ascUnique(points: readonly SpreadPoint[]): SpreadPoint[] {
  const byTime = new Map<number, SpreadPoint>();
  for (const p of points) byTime.set(p.time, p);
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

/**
 * Splits samples into the BASELINE band and the line drawn after quoting began. The baseline
 * recorder and the live indexer can both write the same bucket, so the two sets may overlap in
 * time; the bridge point that closes the visual gap is added only when the baseline ends first.
 */
export function splitSpreadSeries(points: readonly SpreadPoint[]): SpreadSeries {
  const baseline = ascUnique(points.filter((p) => p.baseline));
  const live = ascUnique(points.filter((p) => !p.baseline));
  const lastBaseline = baseline[baseline.length - 1];
  const firstLive = live[0];
  const bridged = lastBaseline && firstLive && lastBaseline.time < firstLive.time ? [lastBaseline, ...live] : live;
  return { baseline, live: bridged };
}
