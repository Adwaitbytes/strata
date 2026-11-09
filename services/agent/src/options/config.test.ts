import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getMarkets } from "@strata/config";
import { OptionsConfig, loadOptionsConfig, resolveUnderlyings, runnerParams } from "./config.js";

const PATH = new URL("../../config/options/strata-options.json", import.meta.url).pathname;
const raw = (): Record<string, unknown> => JSON.parse(readFileSync(PATH, "utf8")) as Record<string, unknown>;

describe("options config", () => {
  it("loads the committed strata-options config", () => {
    const cfg = loadOptionsConfig(PATH);
    expect(cfg.name).toBe("strata-options");
    expect(cfg.simulated).toBe(true);
    expect(cfg.underlyings.map((u) => u.underlying)).toEqual(["SICI", "US500", "USTECH", "XAU", "XAG", "WTI"]);
    expect(runnerParams(cfg).minTenorMs).toBe(24 * 3_600_000);
  });

  it("refuses mainnet and non-simulated configs", () => {
    expect(OptionsConfig.safeParse({ ...raw(), network: "mainnet" }).success).toBe(false);
    expect(OptionsConfig.safeParse({ ...raw(), simulated: false }).success).toBe(false);
  });

  it("refuses a delta band outside 0.15 to 0.30", () => {
    const cfg = raw();
    expect(OptionsConfig.safeParse({ ...cfg, strategy: { ...(cfg["strategy"] as object), maxAbsDelta: 0.5 } }).success).toBe(false);
  });

  it("resolves underlyings to verified mainnet perps with session classes", () => {
    const specs = resolveUnderlyings(loadOptionsConfig(PATH), getMarkets("mainnet"));
    const us500 = specs.find((s) => s.spec.underlying === "US500");
    expect(us500?.spec.marketId).toBe("0x7b3bcf125dfa50ae8d44ecb60119ef5d52a627ad757b727850b0903b55e49b2c");
    expect(us500?.spec.sessionClass).toBe("us_equity");
    expect(specs.find((s) => s.spec.underlying === "SICI")?.spec.sessionClass).toBe("always_open");
    expect(specs.find((s) => s.spec.underlying === "XAU")?.spec.sessionClass).toBe("cme_globex");
    expect(us500?.oracle).toEqual({ oracleType: "pythpro", oracleBase: "1398", oracleQuote: "7" });
  });
});
