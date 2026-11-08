import { describe, expect, it } from "vitest";
import { sparkPath } from "./Sparkline";

describe("sparkPath", () => {
  it("returns empty geometry for no values", () => {
    expect(sparkPath([], 100, 20)).toEqual({ line: "", area: "", last: null });
  });

  it("maps min to the bottom and max to the top inside the padding", () => {
    const { line, last } = sparkPath([0, 10], 100, 20, 2);
    expect(line).toBe("M2.00 18.00 L98.00 2.00");
    expect(last).toEqual([98, 2]);
  });

  it("draws a flat series at the bottom without dividing by zero", () => {
    const { line } = sparkPath([5, 5, 5], 10, 10, 0);
    expect(line).toBe("M0.00 10.00 L5.00 10.00 L10.00 10.00");
  });
});
