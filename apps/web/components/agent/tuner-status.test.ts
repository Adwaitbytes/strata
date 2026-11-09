import type { TunerEvent } from "@strata/sdk";
import { describe, expect, it } from "vitest";
import { tunerOutcome } from "./tuner-status";

const params = { gamma: 0.1, minHalfSpreadBps: 10, levels: 3, sizeMultiplier: 1, offHoursQuoting: false };
const event = (over: Partial<TunerEvent>): TunerEvent => ({
  network: "testnet",
  id: "e1",
  agentId: 1,
  marketId: `0x${"a".repeat(64)}`,
  mode: "shadow",
  model: "m",
  before: params,
  suggested: { ...params, gamma: 0.11 },
  applied: { ...params, gamma: 0.11 },
  clamped: [],
  rationale: "r",
  rejected: false,
  rejectReason: null,
  at: 1,
  ...over,
});

describe("tunerOutcome", () => {
  it("never reports a shadow event as applied, even when legacy data carries applied values", () => {
    expect(tunerOutcome(event({ mode: "shadow" }))).toBe("suggested");
  });
  it("reports a live event with applied values as applied", () => {
    expect(tunerOutcome(event({ mode: "live" }))).toBe("applied");
  });
  it("reports rejections in any mode", () => {
    expect(tunerOutcome(event({ rejected: true, applied: null, rejectReason: "invalid JSON" }))).toBe("rejected");
  });
  it("does not call a live event applied when nothing was applied", () => {
    expect(tunerOutcome(event({ mode: "live", applied: null }))).toBe("suggested");
  });
});
