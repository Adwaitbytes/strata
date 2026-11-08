import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import WebSocket from "ws";
import { ApiError, WsServerMessage } from "@strata/sdk";
import { buildApp } from "../src/create-app.js";
import { MemoryRepo } from "./support/memory-repo.js";
import { testConfig } from "./support/config.js";
import { MARKET_A, book } from "./support/fixtures.js";

let repo: MemoryRepo;
let app: FastifyInstance;
let base: string;

beforeEach(async () => {
  repo = new MemoryRepo();
  repo.data.books = [book(MARKET_A, Date.now())];
  app = await buildApp({ config: testConfig({ CORS_ORIGINS: "https://strata.example", WS_MAX_CONNECTIONS: "3" }), repo, streamHubOptions: { statePollMs: 20, slowPollMs: 20 } });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  if (addr === null || typeof addr === "string") throw new Error("no address");
  base = `127.0.0.1:${addr.port}`;
});
afterEach(async () => {
  await app.close();
});

function open(headers: Record<string, string> = {}): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${base}/v1/stream`, { headers });
    ws.once("open", () => resolve(ws));
    ws.once("unexpected-response", (_req, res) => reject(new Error(`status ${res.statusCode}`)));
    ws.once("error", reject);
  });
}

function nextMessage(ws: WebSocket): Promise<WsServerMessage> {
  return new Promise((resolve) => ws.once("message", (d) => resolve(WsServerMessage.parse(JSON.parse(String(d))))));
}

describe("ws /v1/stream", () => {
  it("answers ping with pong", async () => {
    const ws = await open();
    ws.send(JSON.stringify({ op: "ping" }));
    expect(await nextMessage(ws)).toEqual({ type: "pong" });
    ws.close();
  });

  it("streams a book channel after subscribe", async () => {
    const ws = await open();
    ws.send(JSON.stringify({ op: "subscribe", network: "testnet", channels: [`book:${MARKET_A}`] }));
    const msg = await nextMessage(ws);
    expect(msg.type).toBe("book");
    ws.close();
  });

  it("returns an error message for invalid client messages and keeps the socket open", async () => {
    const ws = await open();
    ws.send("not json");
    expect((await nextMessage(ws)).type).toBe("error");
    ws.send(JSON.stringify({ op: "subscribe", network: "testnet", channels: ["book:nope"] }));
    expect((await nextMessage(ws)).type).toBe("error");
    ws.send(JSON.stringify({ op: "ping" }));
    expect((await nextMessage(ws)).type).toBe("pong");
    ws.close();
  });

  it("rejects a browser origin outside the allow-list", async () => {
    await expect(open({ origin: "https://evil.example" })).rejects.toThrow("status 403");
    const ok = await open({ origin: "https://strata.example" });
    ok.close();
  });

  it("refuses connections above the per-instance cap", async () => {
    const sockets = await Promise.all([open(), open(), open()]);
    const extra = await open();
    const code = await new Promise<number>((resolve) => extra.once("close", (c) => resolve(c)));
    expect(code).toBe(1013);
    for (const s of sockets) s.close();
  });

  it("answers a plain HTTP GET with 426", async () => {
    const res = await fetch(`http://${base}/v1/stream`);
    expect(res.status).toBe(426);
    expect(ApiError.parse(await res.json()).error.code).toBe("bad_request");
  });
});

describe("SSE fallback /v1/stream/sse", () => {
  it("streams book events as text/event-stream", async () => {
    const ctrl = new AbortController();
    const res = await fetch(`http://${base}/v1/stream/sse?network=testnet&channels=book:${MARKET_A}`, { signal: ctrl.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    let text = "";
    while (!/event: book\ndata: .*\n\n/.test(text)) {
      const { value, done } = await reader.read();
      if (done) break;
      text += new TextDecoder().decode(value);
    }
    ctrl.abort();
    const dataLine = text.split("\n").find((l) => l.startsWith("data: "));
    expect(text.startsWith("retry: 3000")).toBe(true);
    expect(WsServerMessage.parse(JSON.parse((dataLine as string).slice(6))).type).toBe("book");
  });

  it("rejects invalid channels with 400", async () => {
    const res = await fetch(`http://${base}/v1/stream/sse?network=testnet&channels=book:bad`);
    expect(res.status).toBe(400);
  });
});
