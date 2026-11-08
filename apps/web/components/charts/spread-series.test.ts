import { describe, expect, it } from "vitest";
import type { UTCTimestamp } from "lightweight-charts";
import { splitSpreadSeries, type SpreadPoint } from "./spread-series";

const pt = (time: number, value: number, baseline: boolean): SpreadPoint => ({ time: time as UTCTimestamp, value, baseline });

describe("splitSpreadSeries", () => {
  it("bridges the baseline into the live line when quoting starts after the baseline", () => {
    const s = splitSpreadSeries([pt(1, 10, true), pt(2, 9, true), pt(3, 5, false), pt(4, 4, false)]);
    expect(s.baseline.map((p) => p.time)).toEqual([1, 2]);
    expect(s.live.map((p) => p.time)).toEqual([2, 3, 4]);
  });

  it("keeps each series strictly ascending when baseline and live samples overlap in time", () => {
    // Real API shape on testnet: a TESTNET sample inside the baseline window, same bucket as a BASELINE one.
    const s = splitSpreadSeries([pt(100, 1, true), pt(400, 2, false), pt(400, 3, true), pt(700, 4, true), pt(400, 2.5, false)]);
    expect(s.baseline.map((p) => p.time)).toEqual([100, 400, 700]);
    expect(s.live).toEqual([pt(400, 2.5, false)]);
  });

  it("returns empty series for no samples", () => {
    expect(splitSpreadSeries([])).toEqual({ baseline: [], live: [] });
  });
});
