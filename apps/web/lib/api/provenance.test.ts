import { MockInProductionError } from "@strata/sdk";
import { describe, expect, it } from "vitest";
import { assertNoMockDeep, containsMock, dominantProvenance } from "./provenance";

const nested = { rows: [{ provenance: "LIVE" }, { inner: { history: [{ provenance: "MOCK" }] } }] };

describe("provenance guards", () => {
  it("throws on nested MOCK in production", () => {
    expect(() => assertNoMockDeep(nested, "production")).toThrow(MockInProductionError);
  });

  it("allows MOCK in development", () => {
    expect(() => assertNoMockDeep(nested, "development")).not.toThrow();
  });

  it("allows non-MOCK in production", () => {
    expect(() => assertNoMockDeep({ a: [{ provenance: "TESTNET" }] }, "production")).not.toThrow();
  });

  it("detects MOCK anywhere", () => {
    expect(containsMock(nested)).toBe(true);
    expect(containsMock({ provenance: "LIVE" })).toBe(false);
  });

  it("picks the most cautious label", () => {
    expect(dominantProvenance(["LIVE", "BASELINE"])).toBe("BASELINE");
    expect(dominantProvenance(["LIVE", "TESTNET", "SIMULATED"])).toBe("SIMULATED");
    expect(dominantProvenance([])).toBe("LIVE");
  });
});
