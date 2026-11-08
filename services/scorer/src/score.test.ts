import { describe, expect, it } from "vitest";
import { ScoreFlag } from "@strata/sdk";
import type { AgentMetrics } from "./metrics.js";
import { DEFAULT_SCORE_PARAMS, minMaxNorm, penalty, scoreAgents } from "./score.js";

function metrics(p: Partial<AgentMetrics>): AgentMetrics {
  return {
    quotedSpreadBps: 0,
    depthUsd25: 0,
    uptimeBps: 0,
    bookShare: 0,
    markout60s: 0,
    pnlUsd: 0,
    maxDrawdownUsd: 0,
    spreadImprovementBps: 0,
    samples: 720,
    twoSidedSamples: 0,
    totalSamples: 720,
    coverage: 1,
    ...p,
  };
}

const quoting = (p: Partial<AgentMetrics>) => metrics({ twoSidedSamples: 700, ...p });

describe("penalty", () => {
  it("scales linearly to 0.5 at the drawdown scale and caps there", () => {
    expect(penalty(0, 150)).toBe(0);
    expect(penalty(75, 150)).toBeCloseTo(0.25, 12);
    expect(penalty(150, 150)).toBe(0.5);
    expect(penalty(10_000, 150)).toBe(0.5);
  });
});

describe("minMaxNorm", () => {
  it("maps the range onto 0..1", () => {
    expect(minMaxNorm([1, 3, 5], 3, { floor: 0.01, degenerate: "presence" })).toBe(0.5);
  });
  it("gives a lone or tied agent 1 when the value is meaningful and 0 when it is not", () => {
    expect(minMaxNorm([500], 500, { floor: 1, degenerate: "presence" })).toBe(1);
    expect(minMaxNorm([0], 0, { floor: 1, degenerate: "presence" })).toBe(0);
    expect(minMaxNorm([7, 7], 7, { floor: 1, degenerate: "presence" })).toBe(1);
  });
  it("gives a lone signed metric the neutral 0.5", () => {
    expect(minMaxNorm([-3], -3, { floor: 0.01, degenerate: "neutral" })).toBe(0.5);
  });
});

describe("scoreAgents", () => {
  it("gives a lone active agent with clean metrics the full 10000", () => {
    const [s] = scoreAgents(
      [{ agentId: 1, flags: 0, metrics: quoting({ depthUsd25: 2_000, uptimeBps: 9_000, quotedSpreadBps: 12, bookShare: 0.2 }) }],
      DEFAULT_SCORE_PARAMS,
    );
    expect(s!.score).toBe(10_000);
  });

  it("gives a lone agent that never quoted 0", () => {
    const [s] = scoreAgents([{ agentId: 1, flags: 0, metrics: metrics({}) }], DEFAULT_SCORE_PARAMS);
    expect(s!.score).toBe(0);
    expect(s!.components.invSpread).toBe(0);
  });

  it("applies the PRD 10.3 formula across three agents", () => {
    const out = scoreAgents(
      [
        { agentId: 1, flags: 0, metrics: quoting({ depthUsd25: 3_000, uptimeBps: 9_000, quotedSpreadBps: 10, bookShare: 0.3, markout60s: 5 }) },
        { agentId: 2, flags: 0, metrics: quoting({ depthUsd25: 1_000, uptimeBps: 5_000, quotedSpreadBps: 20, bookShare: 0.1, markout60s: -5, maxDrawdownUsd: 75 }) },
        { agentId: 3, flags: 0, metrics: quoting({ depthUsd25: 2_000, uptimeBps: 7_000, quotedSpreadBps: 40 / 3, bookShare: 0.2, markout60s: 0, maxDrawdownUsd: 15 }) },
      ],
      DEFAULT_SCORE_PARAMS,
    );
    const by = new Map(out.map((s) => [s.agentId, s]));
    expect(by.get(1)!.score).toBe(10_000);
    expect(by.get(2)!.score).toBe(0);
    // liquidity 0.5, quality 0.5 + 0.5 - 0.05 = 0.95, score = 10000 * 0.5 * (0.7 + 0.285)
    expect(by.get(3)!.liquidity).toBeCloseTo(0.5, 9);
    expect(by.get(3)!.quality).toBeCloseTo(0.95, 9);
    expect(by.get(3)!.score).toBe(4_925);
  });

  it("clamps quality to 0 when markout is worst and drawdown is at the cap", () => {
    const out = scoreAgents(
      [
        { agentId: 1, flags: 0, metrics: quoting({ depthUsd25: 1_000, uptimeBps: 5_000, quotedSpreadBps: 10, bookShare: 0.1, markout60s: 10 }) },
        { agentId: 2, flags: 0, metrics: quoting({ depthUsd25: 1_000, uptimeBps: 5_000, quotedSpreadBps: 10, bookShare: 0.1, markout60s: -10, maxDrawdownUsd: 1_000 }) },
      ],
      DEFAULT_SCORE_PARAMS,
    );
    const two = out.find((s) => s.agentId === 2)!;
    expect(two.quality).toBe(0);
    expect(two.score).toBe(7_000);
  });

  it("disqualifies flagged agents and leaves them out of the normalization range", () => {
    const out = scoreAgents(
      [
        { agentId: 1, flags: 0, metrics: quoting({ depthUsd25: 1_000, uptimeBps: 8_000, quotedSpreadBps: 10, bookShare: 0.1 }) },
        { agentId: 2, flags: ScoreFlag.WASH, metrics: quoting({ depthUsd25: 1_000_000, uptimeBps: 10_000, quotedSpreadBps: 1, bookShare: 0.9 }) },
      ],
      DEFAULT_SCORE_PARAMS,
    );
    expect(out.find((s) => s.agentId === 2)!.score).toBe(0);
    expect(out.find((s) => s.agentId === 1)!.score).toBe(10_000);
  });

  it("floors spread at 0.1 bps so a zero spread cannot divide by zero", () => {
    const [s] = scoreAgents([{ agentId: 1, flags: 0, metrics: quoting({ quotedSpreadBps: 0 }) }], DEFAULT_SCORE_PARAMS);
    expect(s!.components.invSpread).toBe(10);
  });

  it("returns agents in input order", () => {
    const out = scoreAgents(
      [3, 1, 2].map((agentId) => ({ agentId, flags: 0, metrics: metrics({}) })),
      DEFAULT_SCORE_PARAMS,
    );
    expect(out.map((s) => s.agentId)).toEqual([3, 1, 2]);
  });
});
