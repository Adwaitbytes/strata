import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MAINNET_CAPITAL_CAP_USD } from "@strata/config";
import type { Market } from "@strata/sdk";
import { AgentConfig, AgentEnv, buildRiskParams, loadAgentConfig, resolveMarkets } from "./config.js";

const CONFIG_DIR = new URL("../../config/agents/", import.meta.url).pathname;
const hex = (c: string) => `0x${c.repeat(64)}`;

function market(ticker: string, over: Partial<Market> = {}): Market {
  return {
    network: "testnet",
    marketId: hex("1"),
    ticker,
    symbol: ticker.split("/")[0]!,
    assetClass: "crypto",
    quoteDenom: "usdc",
    quoteDecimals: 6,
    oracleType: "PythPro",
    oracleBase: "x",
    oracleQuote: "y",
    minPriceTickSize: "0.01",
    minQuantityTickSize: "0.001",
    minNotional: "1",
    makerFeeRate: "0.0001",
    takerFeeRate: "0.0005",
    initialMarginRatio: "0.05",
    maintenanceMarginRatio: "0.025",
    isPerpetual: true,
    arenaEnabled: true,
    maxSpreadBps: 50,
    minDepthUsd: 1000,
    fetchedAt: 1,
    source: "https://example.org/live-query",
    ...over,
  };
}

describe("committed house agent configs", () => {
  const files = readdirSync(CONFIG_DIR).filter((f) => f.endsWith(".json"));

  it("all parse and pass the mainnet cap check", () => {
    expect(files.sort()).toEqual(["strata-atlas.json", "strata-meridian.json", "strata-test-1.json", "strata-test-2.json", "strata-test-3.json"]);
    for (const f of files) {
      const cfg = loadAgentConfig(join(CONFIG_DIR, f));
      expect(cfg.name).toBe(f.replace(/\.json$/, ""));
      for (const m of cfg.markets) expect(() => buildRiskParams(cfg, m)).not.toThrow();
    }
  });

  it("keeps mainnet agents disabled at the TESTNET release stage (D27, D33)", () => {
    for (const name of ["strata-atlas", "strata-meridian"]) {
      const cfg = loadAgentConfig(join(CONFIG_DIR, `${name}.json`));
      expect(cfg.network).toBe("mainnet");
      expect(cfg.enabled).toBe(false);
      expect(cfg.capitalUsd).toBeLessThanOrEqual(MAINNET_CAPITAL_CAP_USD);
    }
  });

  it("never hand-types market IDs", () => {
    for (const f of files) expect(readFileSync(join(CONFIG_DIR, f), "utf8")).not.toMatch(/0x[0-9a-fA-F]{64}/);
  });

  it("starts the tuner in shadow mode", () => {
    for (const f of files) expect(loadAgentConfig(join(CONFIG_DIR, f)).tuner.mode).not.toBe("live");
  });
});

describe("buildRiskParams", () => {
  const cfg = AgentConfig.parse({
    name: "strata-x",
    network: "mainnet",
    enabled: true,
    capitalUsd: 500,
    params: { maxDailyLossUsd: 25, maxDrawdownUsd: 75, maxGrossNotionalUsd: 500, maxNetNotionalUsd: 200, inventoryCapUsd: 100 },
    markets: [{ ticker: "XAU/USDC PERP", params: { gamma: 0.2 } }],
  });

  it("layers defaults, agent params and market params", () => {
    expect(buildRiskParams(cfg, cfg.markets[0]!)).toMatchObject({ gamma: 0.2, maxDailyLossUsd: 25, levels: 3 });
  });

  it("refuses mainnet configs above the hard cap", () => {
    const big = AgentConfig.parse({ ...cfg, capitalUsd: MAINNET_CAPITAL_CAP_USD + 1 });
    expect(() => buildRiskParams(big, big.markets[0]!)).toThrow(/MAINNET_CAPITAL_CAP_USD/);
  });

  it("rejects unknown parameter names", () => {
    expect(AgentConfig.safeParse({ ...cfg, params: { gamma: 1, gama: 2 } }).success).toBe(false);
  });
});

describe("resolveMarkets", () => {
  it("resolves tickers to live market records and derives the session class", () => {
    const cfg = AgentConfig.parse({ name: "strata-t", network: "testnet", enabled: true, capitalUsd: 100, markets: [{ ticker: "BTC/USDC PERP" }, { ticker: "GOLD/USDT PERP", sessionClass: "cme_globex" }] });
    const resolved = resolveMarkets(cfg, [market("BTC/USDC PERP"), market("GOLD/USDT PERP", { marketId: hex("2"), assetClass: "commodity" })]);
    expect(resolved.map((r) => [r.runtime.marketId, r.runtime.sessionClass])).toEqual([
      [hex("1"), "always_open"],
      [hex("2"), "cme_globex"],
    ]);
    expect(resolved[0]!.runtime.spec).toEqual({ tickSize: "0.01", minQuantity: "0.001", minNotional: "1" });
  });

  it("fails loudly when a ticker is missing or on the wrong network", () => {
    const cfg = AgentConfig.parse({ name: "strata-t", network: "testnet", enabled: true, capitalUsd: 100, markets: [{ ticker: "NOPE/USDC PERP" }] });
    expect(() => resolveMarkets(cfg, [market("BTC/USDC PERP")])).toThrow(/NOPE\/USDC PERP/);
    const cfg2 = AgentConfig.parse({ ...cfg, markets: [{ ticker: "BTC/USDC PERP" }] });
    expect(() => resolveMarkets(cfg2, [market("BTC/USDC PERP", { network: "mainnet" })])).toThrow(/network/);
  });
});

describe("AgentEnv", () => {
  it("parses env with defaults", () => {
    const env = AgentEnv.parse({ STRATA_NETWORK: "testnet", AGENT_CONFIG: "strata-test-1" });
    expect(env).toMatchObject({ STRATA_ADAPTER: "injective", METRICS_PORT: 9464, ANTHROPIC_MODEL: "claude-opus-5-5" });
    expect(AgentEnv.parse({ STRATA_NETWORK: "testnet", AGENT_CONFIG: "x", AGENT_ID: "7" }).AGENT_ID).toBe(7);
    expect(AgentEnv.safeParse({ STRATA_NETWORK: "devnet", AGENT_CONFIG: "x" }).success).toBe(false);
  });
});
