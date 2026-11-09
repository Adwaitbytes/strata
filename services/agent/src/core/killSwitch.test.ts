import { describe, expect, it, vi } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  KillSwitch,
  MemoryNonceStore,
  handleInternalKill,
  handleSignedKill,
  installFatalHandlers,
  installShutdownHandlers,
  killFromEnv,
  killRequestMessage,
  verifyKillRequest,
} from "./killSwitch.js";

const NOW = 1_780_000_000_000;
const ident = { agentId: 3, agentName: "strata-test-1" };
const TOKEN = "t".repeat(40);

async function signedRequest(over: Record<string, unknown> = {}, signer = privateKeyToAccount(generatePrivateKey())) {
  const unsigned = { target: "all" as const, closePositions: true, network: "testnet" as const, nonce: "n".repeat(16) + Math.random().toString(36).slice(2), expiresAt: NOW + 60_000, ...over };
  const signature = await signer.signMessage({ message: killRequestMessage(unsigned as Parameters<typeof killRequestMessage>[0]) });
  return { req: { ...unsigned, signature }, owner: signer.address };
}

describe("KillSwitch", () => {
  it("starts alive and latches killed with source and close flag", () => {
    const ks = new KillSwitch(ident);
    expect(ks.state.killed).toBe(false);
    expect(ks.decision()).toBeNull();
    const listener = vi.fn();
    ks.onKill(listener);
    expect(ks.trigger({ target: "all", closePositions: true, source: "telegram", at: NOW })).toBe(true);
    expect(ks.state).toMatchObject({ killed: true, closePositions: true, source: "telegram" });
    expect(listener).toHaveBeenCalledOnce();
    expect(ks.decision()).toMatchObject({ guard: "kill_switch", action: "halt", reason: "kill_switch_telegram" });
    // a later kill without close keeps the earlier close request
    ks.trigger({ target: "all", closePositions: false, source: "api", at: NOW + 1 });
    expect(ks.state.closePositions).toBe(true);
  });

  it("only applies to matching targets", () => {
    const ks = new KillSwitch(ident);
    expect(ks.trigger({ target: 99, closePositions: false, source: "api", at: NOW })).toBe(false);
    expect(ks.trigger({ target: "strata-other", closePositions: false, source: "telegram", at: NOW })).toBe(false);
    expect(ks.state.killed).toBe(false);
    expect(ks.trigger({ target: 3, closePositions: false, source: "api", at: NOW })).toBe(true);
    const byName = new KillSwitch(ident);
    expect(byName.trigger({ target: "strata-test-1", closePositions: false, source: "telegram", at: NOW })).toBe(true);
  });

  it("unsubscribes listeners", () => {
    const ks = new KillSwitch(ident);
    const listener = vi.fn();
    ks.onKill(listener)();
    ks.trigger({ target: "all", closePositions: false, source: "env", at: NOW });
    expect(listener).not.toHaveBeenCalled();
  });
});

describe("env flag", () => {
  it("reads KILL_SWITCH and KILL_SWITCH_CLOSE", () => {
    expect(killFromEnv({}, NOW)).toBeNull();
    expect(killFromEnv({ KILL_SWITCH: "false" }, NOW)).toBeNull();
    expect(killFromEnv({ KILL_SWITCH: "true" }, NOW)).toEqual({ target: "all", closePositions: false, source: "env", at: NOW });
    expect(killFromEnv({ KILL_SWITCH: "1", KILL_SWITCH_CLOSE: "true" }, NOW)?.closePositions).toBe(true);
  });
});

describe("signed admin kill (viem verifyMessage)", () => {
  it("builds a stable canonical message", () => {
    expect(killRequestMessage({ target: 4, closePositions: false, network: "testnet", nonce: "abcdefghijklmnop", expiresAt: 5 })).toBe(
      "STRATA kill request\nnetwork: testnet\ntarget: 4\nclosePositions: false\nnonce: abcdefghijklmnop\nexpiresAt: 5",
    );
  });

  it("accepts a valid owner signature once", async () => {
    const { req, owner } = await signedRequest();
    const nonces = new MemoryNonceStore();
    const ok = await verifyKillRequest(req, { owner, network: "testnet", nowMs: NOW, nonces });
    expect(ok).toMatchObject({ ok: true, request: { target: "all", closePositions: true } });
    const replay = await verifyKillRequest(req, { owner, network: "testnet", nowMs: NOW, nonces });
    expect(replay).toEqual({ ok: false, error: "nonce already used" });
  });

  it("rejects a signature from another wallet without burning the nonce", async () => {
    const { req } = await signedRequest();
    const other = privateKeyToAccount(generatePrivateKey()).address;
    const nonces = new MemoryNonceStore();
    expect(await verifyKillRequest(req, { owner: other, network: "testnet", nowMs: NOW, nonces })).toEqual({ ok: false, error: "bad signature" });
    expect(nonces.size).toBe(0);
  });

  it("rejects expired, far-future, wrong-network, tampered and malformed requests", async () => {
    const nonces = new MemoryNonceStore();
    const { req, owner } = await signedRequest();
    const opts = { owner, network: "testnet" as const, nowMs: NOW, nonces };
    expect(await verifyKillRequest(req, { ...opts, nowMs: NOW + 61_000 })).toEqual({ ok: false, error: "request expired" });
    const far = await signedRequest({ expiresAt: NOW + 3_600_000 });
    expect(await verifyKillRequest(far.req, { ...opts, owner: far.owner })).toEqual({ ok: false, error: "expiry too far in the future" });
    expect(await verifyKillRequest(req, { ...opts, network: "mainnet" })).toEqual({ ok: false, error: "wrong network" });
    expect(await verifyKillRequest({ ...req, closePositions: false }, opts)).toEqual({ ok: false, error: "bad signature" });
    expect(await verifyKillRequest({ ...req, signature: "0x1234" }, opts)).toEqual({ ok: false, error: "bad signature" });
    expect((await verifyKillRequest({ target: "everyone" }, opts)).ok).toBe(false);
  });

  it("evicts expired nonces", async () => {
    const store = new MemoryNonceStore();
    expect(await store.consume("a", 10, 0)).toBe(true);
    expect(await store.consume("a", 10, 5)).toBe(false);
    expect(await store.consume("b", 100, 20)).toBe(true);
    expect(store.size).toBe(1);
  });
});

describe("HTTP handlers", () => {
  it("internal kill requires the bearer token and a valid body (W9 contract)", () => {
    const ks = new KillSwitch(ident);
    const body = { closePositions: true, source: "telegram", requestedAt: NOW };
    expect(handleInternalKill(undefined, body, { token: TOKEN, killSwitch: ks, nowMs: NOW }).status).toBe(401);
    expect(handleInternalKill(`Bearer ${"x".repeat(40)}`, body, { token: TOKEN, killSwitch: ks, nowMs: NOW }).status).toBe(401);
    expect(handleInternalKill(`Bearer ${TOKEN}`, { nope: 1 }, { token: TOKEN, killSwitch: ks, nowMs: NOW }).status).toBe(400);
    expect(handleInternalKill(`Bearer ${TOKEN}`, body, { token: null, killSwitch: ks, nowMs: NOW }).status).toBe(503);
    expect(ks.state.killed).toBe(false);
    expect(handleInternalKill(`Bearer ${TOKEN}`, body, { token: TOKEN, killSwitch: ks, nowMs: NOW }).status).toBe(202);
    expect(ks.state).toMatchObject({ killed: true, closePositions: true, source: "telegram" });
  });

  it("signed kill verifies then triggers", async () => {
    const { req, owner } = await signedRequest({ target: 3 });
    const ks = new KillSwitch(ident);
    const nonces = new MemoryNonceStore();
    expect((await handleSignedKill(req, { owner: null, network: "testnet", killSwitch: ks, nonces, nowMs: NOW })).status).toBe(503);
    expect((await handleSignedKill({ ...req, nonce: "z".repeat(20) }, { owner, network: "testnet", killSwitch: ks, nonces, nowMs: NOW })).status).toBe(401);
    const res = await handleSignedKill(req, { owner, network: "testnet", killSwitch: ks, nonces, nowMs: NOW });
    expect(res.status).toBe(202);
    expect(ks.state).toMatchObject({ killed: true, source: "api" });
    const other = await signedRequest({ target: 77 });
    const ks2 = new KillSwitch(ident);
    const res2 = await handleSignedKill(other.req, { owner: other.owner, network: "testnet", killSwitch: ks2, nonces, nowMs: NOW });
    expect(res2).toMatchObject({ status: 200, body: { applied: false } });
  });
});

describe("shutdown handlers", () => {
  it("cancels all orders before exiting on SIGTERM, once", async () => {
    const handlers = new Map<string, () => void>();
    const proc = { once: (sig: string, fn: () => void) => void handlers.set(sig, fn) };
    const order: string[] = [];
    let resolveShutdown: () => void = () => undefined;
    const shutdown = vi.fn(() => new Promise<void>((res) => {
      order.push("shutdown");
      resolveShutdown = res;
    }));
    const exit = vi.fn((code: number) => void order.push(`exit:${code}`));
    installShutdownHandlers(proc, shutdown, exit);
    handlers.get("SIGTERM")!();
    handlers.get("SIGINT")!();
    expect(shutdown).toHaveBeenCalledOnce();
    expect(exit).not.toHaveBeenCalled();
    resolveShutdown();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    expect(order).toEqual(["shutdown", "exit:0"]);
  });

  it("exits non-zero when shutdown fails", async () => {
    const handlers = new Map<string, () => void>();
    const exit = vi.fn();
    installShutdownHandlers({ once: (s: string, fn: () => void) => void handlers.set(s, fn) }, () => Promise.reject(new Error("rpc down")), exit);
    handlers.get("SIGTERM")!();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
  });

  it("returns a fail(code) that cancels all orders, then exits with that code, sharing the once guard", async () => {
    const handlers = new Map<string, () => void>();
    const shutdown = vi.fn(() => Promise.resolve());
    const exit = vi.fn();
    const fail = installShutdownHandlers({ once: (s: string, fn: () => void) => void handlers.set(s, fn) }, shutdown, exit);
    fail(1);
    handlers.get("SIGTERM")!();
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(shutdown).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledOnce();
  });

  it("forces exit 1 when shutdown hangs past forceExitMs (dead database during cancel-all)", async () => {
    vi.useFakeTimers();
    try {
      const exit = vi.fn();
      const fail = installShutdownHandlers({ once: () => undefined }, () => new Promise<void>(() => undefined), exit, { forceExitMs: 30_000 });
      fail(1);
      await vi.advanceTimersByTimeAsync(29_000);
      expect(exit).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(2_000);
      expect(exit).toHaveBeenCalledWith(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("fatal handlers", () => {
  it("an unhandled rejection is logged and triggers cancel-all with exit 1", () => {
    const listeners = new Map<string, (err: unknown) => void>();
    const proc = { on: (ev: string, fn: (err: unknown) => void) => void listeners.set(ev, fn) };
    const fail = vi.fn();
    const logged: unknown[] = [];
    installFatalHandlers(proc, fail, (kind, err) => void logged.push([kind, err]));
    const err = Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
    listeners.get("unhandledRejection")!(err);
    expect(logged).toEqual([["unhandledRejection", err]]);
    expect(fail).toHaveBeenCalledWith(1);
    listeners.get("uncaughtException")!(new Error("boom"));
    expect(fail).toHaveBeenCalledTimes(2);
  });
});
