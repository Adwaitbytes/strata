import type { HeroStatsResponse, MarketsResponse } from "@strata/sdk";
import { describe, expect, it } from "vitest";
import { buildBaselineCores, buildProofRows, buildStatStrip, buildTerrainField, MAX_RIDGES, NOT_LIVE, NOT_MEASURED } from "./model";

const id = (n: number) => `0x${n.toString(16).padStart(64, "0")}`;

function stats(over: Partial<HeroStatsResponse> = {}): HeroStatsResponse {
  return {
    network: "testnet",
    provenance: "TESTNET",
    agentsLive: 3,
    marketsCovered: 2,
    strataDepthUsd25: 12_500,
    spreadImprovementBps: 4.25,
    layers: [
      { marketId: id(1), symbol: "AAA/USDT", depthUsd25: 40_000, strataDepthUsd25: 10_000 },
      { marketId: id(2), symbol: "BBB/USDT", depthUsd25: 10_000, strataDepthUsd25: 2_500 },
    ],
    at: 1_700_000_000_000,
    ...over,
  };
}

describe("buildStatStrip", () => {
  it("shows every cell as not live when the API is unavailable", () => {
    const strip = buildStatStrip(null, "testnet");
    expect(strip.live).toBe(false);
    expect(strip.provenance).toBeNull();
    for (const c of strip.cells) {
      expect(c.value).toBeNull();
      expect(c.numeric).toBeNull();
      expect(c.emptyLabel).toBe(NOT_LIVE);
    }
  });

  it("formats live values and keeps provenance", () => {
    const strip = buildStatStrip(stats(), "testnet");
    expect(strip.provenance).toBe("TESTNET");
    const byId = Object.fromEntries(strip.cells.map((c) => [c.id, c]));
    expect(byId.agents?.value).toBe("3");
    expect(byId.depth?.value).toBe("$12.5K");
    expect(byId.spread?.value).toBe("+4.3");
    expect(byId.spread?.unit).toBe("bps");
    expect(byId.depth?.source).toContain("testnet TESTNET");
  });

  it("reports a null spread improvement as not measured, not zero", () => {
    const spread = buildStatStrip(stats({ spreadImprovementBps: null }), "testnet").cells.find((c) => c.id === "spread");
    expect(spread?.value).toBeNull();
    expect(spread?.emptyLabel).toBe(NOT_MEASURED);
  });

  it("does not claim a spread improvement while STRATA has no depth on the book", () => {
    const spread = buildStatStrip(stats({ strataDepthUsd25: 0, spreadImprovementBps: 6 }), "testnet").cells.find((c) => c.id === "spread");
    expect(spread?.value).toBeNull();
    expect(spread?.emptyLabel).toBe(NOT_MEASURED);
  });

  it("shows an honest zero when zero agents are live", () => {
    const agents = buildStatStrip(stats({ agentsLive: 0 }), "testnet").cells.find((c) => c.id === "agents");
    expect(agents?.value).toBe("0");
  });
});

describe("buildTerrainField", () => {
  it("falls back to a labeled flat survey without data", () => {
    const f = buildTerrainField(null);
    expect(f.live).toBe(false);
    expect(f.ridges).toHaveLength(0);
    expect(f.caption).toMatch(/not available/);
  });

  it("treats a response with no depth as a flat survey, keeping its network", () => {
    const f = buildTerrainField(stats({ layers: [{ marketId: id(1), symbol: "AAA", depthUsd25: 0, strataDepthUsd25: 0 }] }));
    expect(f.live).toBe(false);
    expect(f.network).toBe("testnet");
    expect(f.caption).toMatch(/no market reports depth/);
  });

  it("orders ridges by depth, scales height by square root and keeps the STRATA share", () => {
    const f = buildTerrainField(stats());
    expect(f.live).toBe(true);
    expect(f.ridges.map((r) => r.symbol)).toEqual(["AAA/USDT", "BBB/USDT"]);
    expect(f.ridges[0]?.height).toBe(1);
    expect(f.ridges[1]?.height).toBeCloseTo(0.5, 5);
    expect(f.ridges[0]?.strataShare).toBeCloseTo(0.25, 5);
    expect(f.provenance).toBe("TESTNET");
  });

  it("reports no STRATA share when STRATA adds nothing", () => {
    const f = buildTerrainField(
      stats({ layers: [{ marketId: id(1), symbol: "AAA", depthUsd25: 5_000, strataDepthUsd25: 0 }] }),
    );
    expect(f.ridges[0]?.strataShare).toBe(0);
  });

  it("caps the number of ridges and keeps tiny markets visible", () => {
    const layers = Array.from({ length: 9 }, (_, i) => ({
      marketId: id(i + 1),
      symbol: `M${i}`,
      depthUsd25: i === 0 ? 1_000_000 : 1,
      strataDepthUsd25: 0,
    }));
    const f = buildTerrainField(stats({ layers }));
    expect(f.ridges).toHaveLength(MAX_RIDGES);
    for (const r of f.ridges) expect(r.height).toBeGreaterThanOrEqual(0.08);
  });
});

describe("buildProofRows", () => {
  const market = (n: number, baselineSamples: number, withNow: boolean): MarketsResponse["markets"][number] => ({
    market: {
      network: "testnet",
      marketId: id(n),
      ticker: `M${n}/USDT PERP`,
      symbol: `M${n}/USDT`,
      assetClass: "equity",
      quoteDenom: "usdt",
      quoteDecimals: 6,
      oracleType: "pyth",
      oracleBase: "a",
      oracleQuote: "b",
      minPriceTickSize: "0.01",
      minQuantityTickSize: "0.01",
      minNotional: "1",
    } as MarketsResponse["markets"][number]["market"],
    now: withNow
      ? { spreadBps: 8, depthUsd25: 9000, strataDepthUsd25: 4000, strataBookShare: 0.4, sessionState: "open", at: 1, provenance: "TESTNET" }
      : null,
    baseline: { spreadBps: 20, depthUsd25: 3000, windowStart: 0, windowEnd: 1, samples: baselineSamples },
  });

  it("returns nothing without data", () => {
    expect(buildProofRows(null)).toEqual([]);
  });

  it("keeps only markets with a sampled baseline and a current reading", () => {
    const rows = buildProofRows({ network: "testnet", at: 1, markets: [market(1, 100, true), market(2, 0, true), market(3, 100, false)] });
    expect(rows.map((r) => r.symbol)).toEqual(["M1/USDT"]);
    expect(rows[0]?.baselineSpreadBps).toBe(20);
    expect(rows[0]?.nowSpreadBps).toBe(8);
  });

  it("drops markets where STRATA has no depth now, so no before/after is claimed", () => {
    const noStrata = market(4, 100, true);
    noStrata.now = { ...noStrata.now!, strataDepthUsd25: 0, strataBookShare: 0 };
    expect(buildProofRows({ network: "testnet", at: 1, markets: [noStrata] })).toEqual([]);
  });

  it("builds BASELINE core samples only for markets with a recorded window", () => {
    const cores = buildBaselineCores({ network: "testnet", at: 1, markets: [market(1, 100, false), market(2, 0, true)] });
    expect(cores).toHaveLength(1);
    expect(cores[0]).toMatchObject({ symbol: "M1/USDT", depthUsd: 3000, spreadBps: 20, samples: 100 });
    expect(buildBaselineCores(null)).toEqual([]);
  });
});
