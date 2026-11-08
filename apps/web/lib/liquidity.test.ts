import { describe, expect, it } from "vitest";
import { classifySample, hasStrataDepth, sampleLabel } from "./liquidity";

describe("liquidity sample labels", () => {
  it("only calls a sample 'With STRATA' when STRATA has depth", () => {
    expect(classifySample({ provenance: "TESTNET", strataDepthUsd25: 1200 })).toBe("strata");
    expect(classifySample({ provenance: "TESTNET", strataDepthUsd25: 0 })).toBe("no_strata");
    expect(classifySample({ provenance: "LIVE", strataDepthUsd25: 0 })).toBe("no_strata");
  });

  it("keeps BASELINE as baseline regardless of depth fields", () => {
    expect(classifySample({ provenance: "BASELINE", strataDepthUsd25: 0 })).toBe("baseline");
  });

  it("names no-STRATA samples by provenance and network", () => {
    expect(sampleLabel({ provenance: "TESTNET", strataDepthUsd25: 0 }, "testnet")).toBe("Testnet, no STRATA quotes");
    expect(sampleLabel({ provenance: "LIVE", strataDepthUsd25: 0 }, "mainnet")).toBe("Mainnet, no STRATA quotes");
    expect(sampleLabel({ provenance: "SIMULATED", strataDepthUsd25: 0 }, "testnet")).toBe("Simulated, no STRATA quotes");
    expect(sampleLabel({ provenance: "TESTNET", strataDepthUsd25: 5 }, "testnet")).toBe("With STRATA");
    expect(sampleLabel({ provenance: "BASELINE", strataDepthUsd25: 0 }, "testnet")).toBe("Before STRATA");
  });

  it("gates before/after comparisons on current STRATA depth", () => {
    expect(hasStrataDepth(null)).toBe(false);
    expect(hasStrataDepth({ strataDepthUsd25: 0 })).toBe(false);
    expect(hasStrataDepth({ strataDepthUsd25: 1 })).toBe(true);
  });
});
