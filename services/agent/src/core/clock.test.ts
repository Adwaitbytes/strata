import { describe, expect, it } from "vitest";
import { MonotonicClock } from "./clock.js";

describe("MonotonicClock", () => {
  it("is strictly increasing even when the source steps backward or stalls", () => {
    const readings = [1_000, 1_000, 900, 1_500, 1_499];
    let i = 0;
    const clock = new MonotonicClock(() => readings[i++]!);
    expect([clock.now(), clock.now(), clock.now(), clock.now(), clock.now()]).toEqual([1_000, 1_001, 1_002, 1_500, 1_501]);
  });

  it("defaults to Date.now", () => {
    const t = new MonotonicClock().now();
    expect(Math.abs(t - Date.now())).toBeLessThan(1_000);
  });
});
