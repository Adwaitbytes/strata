import { describe, expect, it } from "vitest";
import { buildDepthProfile } from "./depth-profile";

const level = (price: string, quantity: string, strataQuantity = "0") => ({ price, quantity, strataQuantity });

describe("buildDepthProfile", () => {
  it("returns null for an empty book", () => {
    expect(buildDepthProfile({ bids: [], asks: [] })).toBeNull();
  });

  it("accumulates size away from the mid on both sides and tracks the STRATA share", () => {
    const p = buildDepthProfile({
      bids: [level("99", "2", "1"), level("98", "3")],
      asks: [level("101", "1"), level("102", "4", "2")],
    });
    expect(p?.bids.map((b) => b.cumulative)).toEqual([2, 5]);
    expect(p?.bids.map((b) => b.strataCumulative)).toEqual([1, 1]);
    expect(p?.asks.map((a) => a.cumulative)).toEqual([1, 5]);
    expect(p?.asks.at(-1)?.strataCumulative).toBe(2);
    expect(p?.minPrice).toBe(98);
    expect(p?.maxPrice).toBe(102);
    expect(p?.maxCumulative).toBe(5);
    expect(p?.contours).toEqual([1.25, 2.5, 3.75, 5]);
  });

  it("never counts more STRATA size than the level holds, and skips malformed levels", () => {
    const p = buildDepthProfile({ bids: [level("99", "1", "9"), level("x", "1")], asks: [] });
    expect(p?.bids).toHaveLength(1);
    expect(p?.bids[0]?.strataCumulative).toBe(1);
  });

  it("limits the number of levels per side", () => {
    const bids = Array.from({ length: 30 }, (_, i) => level(String(100 - i), "1"));
    expect(buildDepthProfile({ bids, asks: [] }, 10)?.bids).toHaveLength(10);
  });
});
