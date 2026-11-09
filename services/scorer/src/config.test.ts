import { getNetwork } from "@strata/config";
import { describe, expect, it } from "vitest";
import { loadScorerConfig } from "./config.js";

const base = {
  STRATA_NETWORK: "testnet",
  SCORER_API_BASE: "https://strata-api.example.test",
  STRATA_ARENA_ADDRESS: "0x00000000000000000000000000000000000a7e4a",
  STRATA_SCORE_ATTESTOR_ADDRESS: "0x000000000000000000000000000000000a77e570",
};

describe("loadScorerConfig", () => {
  it("applies defaults", () => {
    const c = loadScorerConfig(base, []);
    expect(c).toMatchObject({
      network: "testnet",
      settleDelayMs: 120_000,
      pollMs: 30_000,
      metricsPort: 9464,
      dryRun: false,
      once: false,
      attestorKeyName: "strata-testnet-attestor",
      allowMainnet: false,
      expectedEpochSeconds: 3_600,
      rpcUrl: "https://k8s.testnet.json-rpc.injective.network/",
    });
    expect(loadScorerConfig({ ...base, SCORER_RPC_URL: "http://127.0.0.1:8545" }, []).rpcUrl).toBe("http://127.0.0.1:8545");
  });

  it("reads --dry-run and --once flags", () => {
    expect(loadScorerConfig(base, ["--dry-run", "--once"])).toMatchObject({ dryRun: true, once: true });
    expect(loadScorerConfig({ ...base, SCORER_DRY_RUN: "true" }, []).dryRun).toBe(true);
  });

  it("rejects a settle delay shorter than the markout horizon plus book staleness", () => {
    expect(() => loadScorerConfig({ ...base, SCORER_SETTLE_DELAY_SEC: "60" }, [])).toThrow(/SCORER_SETTLE_DELAY_SEC/);
  });

  it("requires contract addresses when the network config has none", () => {
    // Mainnet has no STRATA deployment (D27), so packages/config holds null contracts there.
    expect(() => loadScorerConfig({ STRATA_NETWORK: "mainnet", SCORER_API_BASE: base.SCORER_API_BASE }, [])).toThrow(/STRATA_ARENA_ADDRESS/);
  });

  it("falls back to the deployed testnet contracts from packages/config", () => {
    const c = loadScorerConfig({ STRATA_NETWORK: "testnet", SCORER_API_BASE: base.SCORER_API_BASE }, []);
    expect(c.arena).toBe(getNetwork("testnet").contracts.arena);
    expect(c.attestor).toBe(getNetwork("testnet").contracts.attestor);
  });

  it("rejects an unknown network and a non-https API base", () => {
    expect(() => loadScorerConfig({ ...base, STRATA_NETWORK: "devnet" }, [])).toThrow();
    expect(() => loadScorerConfig({ ...base, SCORER_API_BASE: "ftp://x" }, [])).toThrow(/SCORER_API_BASE/);
  });

  it("allows http only for localhost", () => {
    expect(loadScorerConfig({ ...base, SCORER_API_BASE: "http://localhost:8080" }, []).apiBase).toBe("http://localhost:8080");
  });
});
