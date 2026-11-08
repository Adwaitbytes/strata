import type { UTCTimestamp } from "lightweight-charts";
import type { SampleKind } from "@/lib/liquidity";

export interface SpreadPoint {
  time: UTCTimestamp;
  value: number;
  kind: SampleKind;
}

/** A Lightweight Charts data item; no value is a whitespace point that breaks the line. */
export interface SeriesItem {
  time: UTCTimestamp;
  value?: number;
}

export interface SpreadSeries {
  baseline: SpreadPoint[];
  /** Post-baseline samples where STRATA had depth on the book. */
  strata: SeriesItem[];
  /** Post-baseline samples with no STRATA depth. Never drawn as "With STRATA". */
  noStrata: SeriesItem[];
}

/** Lightweight Charts asserts strictly ascending times per series; keep the last sample per time. */
function ascUnique(points: readonly SpreadPoint[]): SpreadPoint[] {
  const byTime = new Map<number, SpreadPoint>();
  for (const p of points) byTime.set(p.time, p);
  return [...byTime.values()].sort((a, b) => a.time - b.time);
}

/**
 * Splits samples into the BASELINE band and two post-baseline lines that share one timeline:
 * each line carries whitespace where the other has data, so neither is drawn across the other's
 * stretch. The baseline recorder and the live indexer can write the same bucket, so baseline and
 * post-baseline samples may overlap in time; the bridge point that closes the visual gap is added
 * only when the baseline ends before the first post-baseline sample, and only to that sample's line.
 */
export function splitSpreadSeries(points: readonly SpreadPoint[]): SpreadSeries {
  const baseline = ascUnique(points.filter((p) => p.kind === "baseline"));
  const after = ascUnique(points.filter((p) => p.kind !== "baseline"));
  const strata: SeriesItem[] = after.map((p) => (p.kind === "strata" ? { time: p.time, value: p.value } : { time: p.time }));
  const noStrata: SeriesItem[] = after.map((p) => (p.kind === "no_strata" ? { time: p.time, value: p.value } : { time: p.time }));
  const lastBaseline = baseline[baseline.length - 1];
  const first = after[0];
  if (lastBaseline && first && lastBaseline.time < first.time) {
    const bridge = { time: lastBaseline.time, value: lastBaseline.value };
    if (first.kind === "strata") strata.unshift(bridge);
    else noStrata.unshift(bridge);
  }
  return {
    baseline,
    strata: strata.some((p) => p.value !== undefined) ? strata : [],
    noStrata: noStrata.some((p) => p.value !== undefined) ? noStrata : [],
  };
}
