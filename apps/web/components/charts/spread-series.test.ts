import { describe, expect, it } from "vitest";
import type { UTCTimestamp } from "lightweight-charts";
import type { SampleKind } from "@/lib/liquidity";
import { splitSpreadSeries, type SpreadPoint } from "./spread-series";

const pt = (time: number, value: number, kind: SampleKind): SpreadPoint => ({ time: time as UTCTimestamp, value, kind });
const values = (items: { time: number; value?: number }[]) => items.map((p) => [p.time, p.value ?? null]);

describe("splitSpreadSeries", () => {
  it("bridges the baseline into the STRATA line when quoting starts after the baseline", () => {
    const s = splitSpreadSeries([pt(1, 10, "baseline"), pt(2, 9, "baseline"), pt(3, 5, "strata"), pt(4, 4, "strata")]);
    expect(s.baseline.map((p) => p.time)).toEqual([1, 2]);
    expect(values(s.strata)).toEqual([[2, 9], [3, 5], [4, 4]]);
    expect(s.noStrata).toEqual([]);
  });

  it("never draws samples without STRATA depth as the STRATA line", () => {
    const s = splitSpreadSeries([pt(1, 30, "baseline"), pt(2, 28, "no_strata"), pt(3, 27, "no_strata"), pt(4, 9, "strata")]);
    expect(values(s.noStrata)).toEqual([[1, 30], [2, 28], [3, 27], [4, null]]);
    expect(values(s.strata)).toEqual([[2, null], [3, null], [4, 9]]);
  });

  it("drops the STRATA line entirely when STRATA never had depth", () => {
    const s = splitSpreadSeries([pt(1, 30, "baseline"), pt(2, 28, "no_strata")]);
    expect(s.strata).toEqual([]);
    expect(values(s.noStrata)).toEqual([[1, 30], [2, 28]]);
  });

  it("keeps each series strictly ascending when baseline and live samples overlap in time", () => {
    // Real API shape on testnet: a TESTNET sample inside the baseline window, same bucket as a BASELINE one.
    const s = splitSpreadSeries([pt(100, 1, "baseline"), pt(400, 2, "no_strata"), pt(400, 3, "baseline"), pt(700, 4, "baseline"), pt(400, 2.5, "no_strata")]);
    expect(s.baseline.map((p) => p.time)).toEqual([100, 400, 700]);
    expect(values(s.noStrata)).toEqual([[400, 2.5]]);
  });

  it("returns empty series for no samples", () => {
    expect(splitSpreadSeries([])).toEqual({ baseline: [], strata: [], noStrata: [] });
  });
});
