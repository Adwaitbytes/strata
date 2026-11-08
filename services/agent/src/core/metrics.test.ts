import { afterEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createControlServer, createMetrics } from "./metrics.js";
import { KillSwitch, MemoryNonceStore, killRequestMessage } from "./killSwitch.js";

const TOKEN = "k".repeat(40);
let server: Server | null = null;
afterEach(async () => {
  await new Promise<void>((res) => (server ? server.close(() => res()) : res()));
  server = null;
});

async function start(owner: `0x${string}` | null = null) {
  const metrics = createMetrics();
  const killSwitch = new KillSwitch({ agentId: 1, agentName: "strata-test-1" });
  server = createControlServer({
    registry: metrics.registry,
    killSwitch,
    killToken: TOKEN,
    owner,
    network: "testnet",
    nonces: new MemoryNonceStore(),
    now: () => 1_780_000_000_000,
    health: () => ({ agent: "strata-test-1", killed: killSwitch.state.killed }),
  });
  await new Promise<void>((res) => server!.listen(0, "127.0.0.1", () => res()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { metrics, killSwitch, base };
}

describe("metrics", () => {
  it("exposes cycle latency, tx results, halts, inventory, equity, pnl and margin", async () => {
    const { metrics, base } = await start();
    metrics.loop.observeCycle("m1", 0.2, "quoted");
    metrics.loop.txResult("m1", true);
    metrics.loop.txResult("m1", false);
    metrics.loop.halt("m1", "oracle_stale");
    metrics.loop.inventory("m1", 0.5, 50);
    metrics.loop.equity(1_000, -3);
    metrics.loop.marginRatio(2.5);
    metrics.loop.marginRatio(null);
    const text = await (await fetch(`${base}/metrics`)).text();
    for (const name of [
      "strata_agent_cycle_seconds_bucket",
      'strata_agent_tx_total{market="m1",result="ok"} 1',
      'strata_agent_tx_total{market="m1",result="error"} 1',
      'strata_agent_halts_total{market="m1",reason="oracle_stale"} 1',
      'strata_agent_inventory_usd{market="m1"} 50',
      "strata_agent_equity_usd 1000",
      "strata_agent_pnl_usd -3",
      "strata_agent_margin_ratio Nan",
    ]) {
      expect(text).toContain(name);
    }
  });
});

describe("control server", () => {
  it("serves health and 404s unknown routes", async () => {
    const { base } = await start();
    expect(await (await fetch(`${base}/healthz`)).json()).toEqual({ agent: "strata-test-1", killed: false });
    expect((await fetch(`${base}/nope`)).status).toBe(404);
  });

  it("accepts the internal kill with the bearer token only", async () => {
    const { base, killSwitch } = await start();
    const body = JSON.stringify({ closePositions: false, source: "telegram", requestedAt: 5 });
    expect((await fetch(`${base}/internal/kill`, { method: "POST", body })).status).toBe(401);
    expect((await fetch(`${base}/internal/kill`, { method: "POST", body: "{not json", headers: { authorization: `Bearer ${TOKEN}` } })).status).toBe(400);
    const ok = await fetch(`${base}/internal/kill`, { method: "POST", body, headers: { authorization: `Bearer ${TOKEN}` } });
    expect(ok.status).toBe(202);
    expect(killSwitch.state.killed).toBe(true);
  });

  it("accepts a signed admin kill", async () => {
    const signer = privateKeyToAccount(generatePrivateKey());
    const { base, killSwitch } = await start(signer.address);
    const unsigned = { target: "all" as const, closePositions: false, network: "testnet" as const, nonce: "abcdefghijklmnopq", expiresAt: 1_780_000_060_000 };
    const signature = await signer.signMessage({ message: killRequestMessage(unsigned) });
    const res = await fetch(`${base}/admin/kill`, { method: "POST", body: JSON.stringify({ ...unsigned, signature }) });
    expect(res.status).toBe(202);
    expect(killSwitch.state).toMatchObject({ killed: true, source: "api" });
  });

  it("rejects oversized bodies", async () => {
    const { base } = await start();
    const res = await fetch(`${base}/internal/kill`, { method: "POST", body: "x".repeat(70_000), headers: { authorization: `Bearer ${TOKEN}` } });
    expect(res.status).toBe(413);
  });
});
