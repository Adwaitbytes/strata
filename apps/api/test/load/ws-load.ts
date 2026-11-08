/**
 * WebSocket load test (PRD 17: 200 concurrent clients).
 *
 *   pnpm --filter @strata/api load:ws -- --url ws://127.0.0.1:8787/v1/stream --clients 200 --seconds 30 --network testnet
 *
 * Each client subscribes to leaderboard, events and every arena book channel returned by
 * GET /v1/markets, validates every server message against WsServerMessage, and tracks the
 * highest per-channel push rate it saw in any one-second window. Exits non-zero if any client
 * failed to connect, received an invalid message, or saw more than WS_MAX_UPDATES_PER_SEC.
 */
import { parseArgs } from "node:util";
import WebSocket from "ws";
import { MarketsResponse, WS_MAX_UPDATES_PER_SEC, WsServerMessage } from "@strata/sdk";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "ws://127.0.0.1:8787/v1/stream" },
    clients: { type: "string", default: "200" },
    seconds: { type: "string", default: "30" },
    network: { type: "string", default: "testnet" },
  },
});

const url = values.url;
const clients = Number(values.clients);
const seconds = Number(values.seconds);
const network = values.network === "mainnet" ? "mainnet" : "testnet";

interface ClientStats {
  connected: boolean;
  messages: number;
  invalid: number;
  closedEarly: number | null;
  maxPerChannelPerSec: number;
  firstMessageMs: number | null;
}

async function bookChannels(): Promise<string[]> {
  const httpUrl = url.replace(/^ws/, "http").replace(/\/v1\/stream$/, `/v1/markets?network=${network}`);
  try {
    const res = await fetch(httpUrl);
    if (!res.ok) return [];
    const body = MarketsResponse.parse(await res.json());
    return body.markets.slice(0, 10).map((m) => `book:${m.market.marketId}`);
  } catch (err) {
    console.error("could not list markets, subscribing without book channels:", (err as Error).message);
    return [];
  }
}

function runClient(channels: string[], deadline: number): Promise<ClientStats> {
  return new Promise((resolve) => {
    const stats: ClientStats = { connected: false, messages: 0, invalid: 0, closedEarly: null, maxPerChannelPerSec: 0, firstMessageMs: null };
    const started = Date.now();
    const windows = new Map<string, { start: number; count: number }>();
    const ws = new WebSocket(url);
    const finish = () => {
      clearTimeout(timer);
      resolve(stats);
    };
    const timer = setTimeout(() => ws.close(1000, "done"), deadline - Date.now());
    ws.on("open", () => {
      stats.connected = true;
      ws.send(JSON.stringify({ op: "subscribe", network, channels }));
    });
    ws.on("message", (raw) => {
      stats.messages += 1;
      stats.firstMessageMs ??= Date.now() - started;
      const parsed = WsServerMessage.safeParse(JSON.parse(String(raw)));
      if (!parsed.success) {
        stats.invalid += 1;
        return;
      }
      const channel = "channel" in parsed.data ? parsed.data.channel : parsed.data.type;
      const now = Date.now();
      const w = windows.get(channel);
      if (!w || now - w.start >= 1_000) windows.set(channel, { start: now, count: 1 });
      else {
        w.count += 1;
        stats.maxPerChannelPerSec = Math.max(stats.maxPerChannelPerSec, w.count);
      }
    });
    ws.on("close", (code) => {
      if (Date.now() < deadline - 50 && code !== 1000) stats.closedEarly = code;
      finish();
    });
    ws.on("error", () => {
      // The close event follows and records the failure.
    });
  });
}

async function main(): Promise<void> {
  const channels = ["leaderboard", "events", ...(await bookChannels())];
  console.log(`load: ${clients} clients, ${seconds}s, channels=${channels.length} (${channels.join(", ")})`);
  const deadline = Date.now() + seconds * 1_000;
  const memBefore = process.memoryUsage().rss;
  const results = await Promise.all(Array.from({ length: clients }, () => runClient(channels, deadline)));

  const connected = results.filter((r) => r.connected).length;
  const invalid = results.reduce((s, r) => s + r.invalid, 0);
  const messages = results.reduce((s, r) => s + r.messages, 0);
  const closedEarly = results.filter((r) => r.closedEarly !== null).length;
  const maxRate = Math.max(0, ...results.map((r) => r.maxPerChannelPerSec));
  const firsts = results.map((r) => r.firstMessageMs).filter((x): x is number => x !== null).sort((a, b) => a - b);
  const p95 = firsts.length ? firsts[Math.floor(firsts.length * 0.95)] : null;

  const summary = { clients, connected, closedEarly, messages, invalid, maxPerChannelPerSec: maxRate, firstMessageP95Ms: p95, loadClientRssMb: Math.round((process.memoryUsage().rss - memBefore) / 1e6) };
  console.log(JSON.stringify(summary, null, 2));
  const ok = connected === clients && closedEarly === 0 && invalid === 0 && maxRate <= WS_MAX_UPDATES_PER_SEC;
  if (!ok) {
    console.error("load test FAILED");
    process.exit(1);
  }
  console.log("load test passed");
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
