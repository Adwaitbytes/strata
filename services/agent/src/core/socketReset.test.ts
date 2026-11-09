/**
 * Soak finding (2026-11-09): strata-test-1 exited on an unhandled `read ECONNRESET` from a TLS
 * socket. Each network client the agent holds gets a peer reset here, and the test asserts that
 * nothing escapes as an unhandled rejection or uncaught exception. The culprit was postgres.js
 * starting its array-type lookup without a handler (patched in patches/postgres@3.4.9.patch);
 * the pool case below failed before that patch. Indexer gRPC streams and the tuner client are
 * covered in streams.test.ts and tunerScheduler.test.ts (errors go to onError and reconnect).
 */
import { connect, createServer, type AddressInfo, type Server, type Socket } from "node:net";
import postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { KillSwitch, MemoryNonceStore } from "./killSwitch.js";
import { createControlServer, createMetrics } from "./metrics.js";

const escaped: unknown[] = [];
const record = (e: unknown) => void escaped.push(e);
beforeEach(() => {
  escaped.length = 0;
  process.on("unhandledRejection", record);
  process.on("uncaughtException", record);
});
afterEach(() => {
  process.off("unhandledRejection", record);
  process.off("uncaughtException", record);
});
const settle = () => new Promise((r) => setTimeout(r, 100));
const listen = (s: Server) => new Promise<number>((r) => s.listen(0, "127.0.0.1", () => r((s.address() as AddressInfo).port)));
const close = (s: Server) => new Promise((r) => s.close(r));

/* Minimal Postgres wire protocol: enough for startup, LISTEN and simple selects. */
function msg(type: string, body: Buffer = Buffer.alloc(0)): Buffer {
  const head = Buffer.alloc(5);
  head.write(type, 0, "latin1");
  head.writeInt32BE(body.length + 4, 1);
  return Buffer.concat([head, body]);
}
const AUTH_OK = msg("R", Buffer.from([0, 0, 0, 0]));
const READY = msg("Z", Buffer.from("I"));
function replies(chunk: Buffer): Buffer {
  const out: Buffer[] = [];
  for (let i = 0; i + 5 <= chunk.length; ) {
    const type = String.fromCharCode(chunk[i]!);
    const len = chunk.readInt32BE(i + 1);
    if (type === "P") out.push(msg("1"));
    else if (type === "B") out.push(msg("2"));
    else if (type === "D") out.push(msg("t", Buffer.from([0, 0])), msg("n"));
    else if (type === "E") out.push(msg("C", Buffer.from("LISTEN\0")));
    else if (type === "S") out.push(READY);
    else if (type === "Q") out.push(msg("C", Buffer.from("LISTEN\0")), READY);
    i += 1 + len;
  }
  return Buffer.concat(out);
}

/** Serves `healthy` connections normally, then resets every later one on its first query. */
function fakePostgres(healthy: number) {
  const sockets: Socket[] = [];
  let accepted = 0;
  const server = createServer((socket) => {
    const ok = accepted++ < healthy;
    sockets.push(socket);
    socket.on("error", () => undefined);
    let started = false;
    socket.on("data", (chunk) => {
      if (!started) {
        started = true;
        socket.write(Buffer.concat([AUTH_OK, READY]));
        return;
      }
      if (ok) socket.write(replies(chunk));
      else socket.resetAndDestroy();
    });
  });
  return { server, accepted: () => accepted, resetAll: () => sockets.forEach((s) => s.destroyed || s.resetAndDestroy()) };
}

describe("peer resets on agent sockets", () => {
  it("postgres pool: a reset during connection setup reaches the query, not the process", async () => {
    const pg = fakePostgres(0);
    const port = await listen(pg.server);
    const sql = postgres(`postgres://u:p@127.0.0.1:${port}/db`, { max: 1, ssl: false, connect_timeout: 2 });
    await expect(sql`select 1`).rejects.toMatchObject({ code: "ECONNRESET" });
    await settle();
    await sql.end({ timeout: 0 });
    await close(pg.server);
    expect(escaped).toEqual([]);
  });

  it("LISTEN strata_kill connection: a reset after subscribing, and a failed re-subscribe, stay contained", async () => {
    const pg = fakePostgres(1);
    const port = await listen(pg.server);
    const sql = postgres(`postgres://u:p@127.0.0.1:${port}/db`, { max: 1, ssl: false, connect_timeout: 2 });
    await sql.listen("strata_kill", () => undefined);
    pg.resetAll();
    await settle();
    expect(pg.accepted()).toBeGreaterThan(1);
    await sql.end({ timeout: 0 });
    await close(pg.server);
    expect(escaped).toEqual([]);
  });

  it("kill HTTP server: a client reset mid-request leaves the server answering", async () => {
    const metrics = createMetrics();
    const killSwitch = new KillSwitch({ agentId: 1, agentName: "strata-test-1" });
    const server = createControlServer({
      registry: metrics.registry,
      killSwitch,
      killToken: "k".repeat(40),
      owner: null,
      network: "testnet",
      nonces: new MemoryNonceStore(),
      now: () => 1_780_000_000_000,
      health: () => ({ ok: true }),
    });
    const port = await listen(server);
    const client = connect(port, "127.0.0.1");
    client.on("error", () => undefined);
    await new Promise((r) => client.once("connect", r));
    client.write(`POST /internal/kill HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer ${"k".repeat(40)}\r\nContent-Length: 500\r\n\r\n{"tar`);
    await settle();
    client.resetAndDestroy();
    await settle();
    const res = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(res.status).toBe(200);
    expect(killSwitch.state.killed).toBe(false);
    await close(server);
    expect(escaped).toEqual([]);
  });
});
