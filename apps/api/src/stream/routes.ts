/**
 * Live transports over the shared StreamHub:
 * - `ws /v1/stream` (PRD 11.3), zod-validated client messages.
 * - `GET /v1/stream/sse` fallback for hosts or clients without WebSocket support.
 * Both close themselves after `streamMaxMs` (when set) so a serverless host's duration limit
 * ends them cleanly; clients reconnect and resubscribe.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import websocket from "@fastify/websocket";
import type { WebSocket } from "ws";
import { z } from "zod";
import { NetworkName, WsChannel, WsClientMessage, type WsServerMessage } from "@strata/sdk";
import type { ApiConfig } from "../config.js";
import { errorBody, HttpError, parseInput } from "../errors.js";
import type { ReadContext } from "../services/read.js";
import { CLOSE_TRY_AGAIN, StreamHub, type HubOptions, type StreamClient } from "./hub.js";
import { streamSource } from "./source.js";

const MAX_CLIENT_MESSAGE_BYTES = 4_096;
const MAX_SUBSCRIPTIONS_PER_CONNECTION = 50;
const CLIENT_MESSAGES_PER_SEC = 10;
const PING_INTERVAL_MS = 30_000;
const SSE_KEEPALIVE_MS = 15_000;
/** WebSocket close codes: policy violation, service restart. */
const CLOSE_POLICY = 1008;
const CLOSE_RESTART = 1012;

export const SseQuery = z.object({
  network: NetworkName.default("mainnet"),
  channels: z
    .string()
    .max(2_000)
    .transform((s) => s.split(",").map((x) => x.trim()).filter((x) => x.length > 0))
    .pipe(z.array(WsChannel).min(1).max(20)),
});

export interface StreamDeps {
  config: ApiConfig;
  ctx: ReadContext;
  hubOptions?: Partial<HubOptions>;
}

function originAllowed(config: ApiConfig, req: FastifyRequest): boolean {
  const origin = req.headers.origin;
  // Non-browser clients send no Origin; browsers must come from the allow-list.
  return origin === undefined || config.corsOrigins.includes(origin);
}

/** 403 keeps the ApiError code `unauthorized` but tells clients the origin, not a credential, is the problem. */
function forbiddenOrigin(): Error {
  return Object.assign(new Error("origin not allowed"), { statusCode: 403 });
}

/** Messages are serialized by the hub with `type` as the first key. */
function eventName(data: string): string {
  return /^\{"type":"([a-z]+)"/.exec(data)?.[1] ?? "message";
}

function encode(message: WsServerMessage): string {
  return JSON.stringify(message);
}

export async function registerStream(app: FastifyInstance, deps: StreamDeps): Promise<void> {
  const { config } = deps;
  const hub = new StreamHub(streamSource(deps.ctx), deps.hubOptions ?? {}, app.log);
  let connections = 0;
  app.addHook("onClose", async () => hub.close());

  await app.register(websocket, { options: { maxPayload: MAX_CLIENT_MESSAGE_BYTES } });

  app.route({
    method: "GET",
    url: "/v1/stream",
    preValidation: async (req) => {
      if (!originAllowed(config, req)) throw forbiddenOrigin();
    },
    handler: async (_req, reply) => {
      void reply.status(426).header("upgrade", "websocket");
      return errorBody("bad_request", "websocket upgrade required");
    },
    wsHandler: (socket: WebSocket, req: FastifyRequest) => {
      if (connections >= config.wsMaxConnections) {
        socket.close(CLOSE_TRY_AGAIN, "server at capacity");
        return;
      }
      connections += 1;
      const client: StreamClient = {
        send: (data) => socket.send(data),
        bufferedAmount: () => socket.bufferedAmount,
        close: (code, reason) => socket.close(code, reason),
      };
      const subscriptions = new Set<string>();
      let windowStart = Date.now();
      let messagesInWindow = 0;
      let alive = true;

      const ping = setInterval(() => {
        if (!alive) {
          socket.terminate();
          return;
        }
        alive = false;
        socket.ping();
      }, PING_INTERVAL_MS);
      const maxLife = config.streamMaxMs > 0 ? setTimeout(() => socket.close(CLOSE_RESTART, "reconnect"), config.streamMaxMs) : null;
      socket.on("pong", () => {
        alive = true;
      });

      const reject = (message: string) => socket.send(encode({ type: "error", message }));

      socket.on("message", (raw, isBinary) => {
        const now = Date.now();
        if (now - windowStart >= 1_000) {
          windowStart = now;
          messagesInWindow = 0;
        }
        messagesInWindow += 1;
        if (messagesInWindow > CLIENT_MESSAGES_PER_SEC) {
          socket.close(CLOSE_POLICY, "too many messages");
          return;
        }
        if (isBinary) return reject("binary frames are not supported");
        let json: unknown;
        try {
          json = JSON.parse(String(raw));
        } catch {
          return reject("message is not valid JSON");
        }
        const parsed = WsClientMessage.safeParse(json);
        if (!parsed.success) return reject("message does not match the stream protocol");
        const msg = parsed.data;
        if (msg.op === "ping") {
          socket.send(encode({ type: "pong" }));
          return;
        }
        for (const channel of msg.channels) {
          const key = `${msg.network}|${channel}`;
          if (msg.op === "subscribe") {
            if (!subscriptions.has(key) && subscriptions.size >= MAX_SUBSCRIPTIONS_PER_CONNECTION) {
              return reject(`at most ${MAX_SUBSCRIPTIONS_PER_CONNECTION} subscriptions per connection`);
            }
            subscriptions.add(key);
            hub.subscribe(client, msg.network, channel);
          } else {
            subscriptions.delete(key);
            hub.unsubscribe(client, msg.network, channel);
          }
        }
      });

      socket.on("close", () => {
        connections -= 1;
        clearInterval(ping);
        if (maxLife) clearTimeout(maxLife);
        hub.remove(client);
      });
      socket.on("error", (err) => req.log.warn({ err }, "websocket error"));
    },
  });

  app.get("/v1/stream/sse", async (req: FastifyRequest, reply: FastifyReply) => {
    if (!originAllowed(config, req)) throw forbiddenOrigin();
    const query = parseInput(SseQuery, req.query, "query");
    if (connections >= config.wsMaxConnections) throw new HttpError("unavailable", "server at capacity");
    connections += 1;

    // Hijacked responses skip onSend, so copy the security and CORS headers set by earlier hooks.
    const headers: Record<string, string | number | string[]> = {};
    for (const [k, v] of Object.entries(reply.getHeaders())) if (v !== undefined) headers[k] = v;
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      ...headers,
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    res.write("retry: 3000\n\n");

    const client: StreamClient = {
      send: (data) => {
        res.write(`event: ${eventName(data)}\ndata: ${data}\n\n`);
      },
      bufferedAmount: () => res.writableLength,
      close: () => res.end(),
    };
    for (const channel of query.channels) hub.subscribe(client, query.network, channel);

    const keepalive = setInterval(() => res.write(": keepalive\n\n"), SSE_KEEPALIVE_MS);
    const maxLife = config.streamMaxMs > 0 ? setTimeout(() => res.end(), config.streamMaxMs) : null;
    const cleanup = () => {
      clearInterval(keepalive);
      if (maxLife) clearTimeout(maxLife);
      hub.remove(client);
    };
    let done = false;
    req.raw.on("close", () => {
      if (done) return;
      done = true;
      connections -= 1;
      cleanup();
    });
  });
}
