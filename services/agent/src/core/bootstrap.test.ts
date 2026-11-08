import { describe, expect, it, vi } from "vitest";
import { AgentConfig, AgentEnv } from "./config.js";
import { SimExchange } from "./sim/simExchange.js";
import { assertRunnable, buildSimMarkets, driveSim, loadInjectiveAdapter, provenanceFor, resolveConfigPath } from "./bootstrap.js";

const env = (over: Record<string, string> = {}) => AgentEnv.parse({ STRATA_NETWORK: "testnet", AGENT_CONFIG: "strata-test-1", AGENT_ID: "4", ...over });
const cfg = (over: Record<string, unknown> = {}) =>
  AgentConfig.parse({ name: "strata-test-1", network: "testnet", enabled: true, capitalUsd: 100, markets: [{ ticker: "BTC/USDC PERP" }], ...over });

describe("resolveConfigPath", () => {
  it("maps a name to config/agents and passes paths through", () => {
    expect(resolveConfigPath("strata-test-1")).toMatch(/config\/agents\/strata-test-1\.json$/);
    expect(resolveConfigPath("/tmp/x.json")).toBe("/tmp/x.json");
    expect(() => resolveConfigPath("../etc/passwd")).toThrow(/agent config name/);
  });
});

describe("assertRunnable", () => {
  it("accepts an enabled testnet config with an agent ID", () => {
    expect(assertRunnable(cfg(), env())).toBe(4);
  });
  it("refuses network mismatch, disabled configs, missing agent ID and mainnet without go-ahead", () => {
    expect(() => assertRunnable(cfg(), env({ STRATA_NETWORK: "mainnet" }))).toThrow(/network/);
    expect(() => assertRunnable(cfg({ enabled: false }), env())).toThrow(/disabled/);
    expect(() => assertRunnable(cfg(), AgentEnv.parse({ STRATA_NETWORK: "testnet", AGENT_CONFIG: "x" }))).toThrow(/AGENT_ID/);
    const main = cfg({ network: "mainnet" });
    expect(() => assertRunnable(main, env({ STRATA_NETWORK: "mainnet" }))).toThrow(/MAINNET_GO_AHEAD/);
    expect(() => assertRunnable(main, env({ STRATA_NETWORK: "mainnet", STRATA_ADAPTER: "sim", MAINNET_GO_AHEAD: "true" }))).toThrow(/simulator/);
    expect(assertRunnable(main, env({ STRATA_NETWORK: "mainnet", MAINNET_GO_AHEAD: "true" }))).toBe(4);
  });
});

describe("provenanceFor", () => {
  it("labels every number by where it came from", () => {
    expect(provenanceFor("testnet", "sim")).toBe("SIMULATED");
    expect(provenanceFor("testnet", "injective")).toBe("TESTNET");
    expect(provenanceFor("mainnet", "injective")).toBe("LIVE");
  });
});

describe("buildSimMarkets", () => {
  it("creates SIMULATED markets with synthetic IDs and a working simulator", async () => {
    const { resolved, sim } = buildSimMarkets(cfg({ markets: [{ ticker: "BTC/USDC PERP" }, { ticker: "XAU/USDC PERP", sessionClass: "cme_globex" }] }), 1_780_000_000_000);
    expect(resolved).toHaveLength(2);
    expect(resolved[0]!.runtime.marketId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(resolved[1]!.runtime.sessionClass).toBe("cme_globex");
    expect(resolved[0]!.market.source).toMatch(/^https:\/\//);
    const st = await sim.getMarketState(resolved[0]!.runtime.marketId);
    expect(Number(st.oracle.price)).toBeGreaterThan(0);
    expect(sim).toBeInstanceOf(SimExchange);
  });
});

describe("loadInjectiveAdapter", () => {
  const opts = { network: "testnet" as const, agentName: "strata-test-1", markets: [], secretsDir: ".secrets" };
  it("calls the W3 factory and validates the adapter shape", async () => {
    const sim = buildSimMarkets(cfg(), 0).sim;
    const adapter = await loadInjectiveAdapter(opts, async () => ({ createInjectiveAdapter: async () => sim }));
    expect(adapter).toBe(sim);
  });
  it("fails clearly when the module or adapter is malformed", async () => {
    await expect(loadInjectiveAdapter(opts, async () => ({}))).rejects.toThrow(/createInjectiveAdapter/);
    await expect(loadInjectiveAdapter(opts, async () => ({ createInjectiveAdapter: async () => ({ network: "testnet" }) }))).rejects.toThrow(/ExchangeAdapter/);
    const sim = buildSimMarkets(cfg(), 0).sim;
    await expect(loadInjectiveAdapter({ ...opts, network: "mainnet" }, async () => ({ createInjectiveAdapter: () => sim }))).rejects.toThrow(/network/);
  });
});

describe("driveSim", () => {
  it("advances chain time and keeps the simulated oracle fresh", async () => {
    vi.useFakeTimers();
    try {
      const { resolved, sim } = buildSimMarkets(cfg(), 1_000_000);
      const id = resolved[0]!.runtime.marketId;
      const stop = driveSim(sim, [id], 1_000, () => 0.99);
      await vi.advanceTimersByTimeAsync(3_000);
      const st = await sim.getMarketState(id);
      expect(st.chainTimeMs).toBe(1_003_000);
      expect(st.chainTimeMs - st.oracle.timestampMs).toBeLessThan(1_000);
      expect(Number(st.oracle.price)).toBeGreaterThan(100);
      stop();
      await vi.advanceTimersByTimeAsync(3_000);
      expect((await sim.getMarketState(id)).chainTimeMs).toBe(1_003_000);
    } finally {
      vi.useRealTimers();
    }
  });
});
