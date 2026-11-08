/**
 * Prometheus metrics (prom-client) and the agent control server. The server listens on the
 * private compose network only (see packages/alerts internal-kill contract) and serves:
 *   GET  /metrics        Prometheus scrape
 *   GET  /healthz        liveness for the Telegram bot /status and docker
 *   POST /internal/kill  Telegram kill relayed by the alerts bot (bearer token)
 *   POST /admin/kill     signed owner KillRequest (@strata/sdk)
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";
import type { Address } from "viem";
import type { NetworkName } from "@strata/sdk";
import { handleInternalKill, handleSignedKill, type HttpResult, type KillSwitch, type NonceStore } from "./killSwitch.js";
import type { LoopMetrics } from "./loop.js";

export interface AgentMetrics {
  readonly registry: Registry;
  readonly loop: LoopMetrics;
}

export function createMetrics(registry: Registry = new Registry(), withDefaults = false): AgentMetrics {
  if (withDefaults) collectDefaultMetrics({ register: registry });
  const cycle = new Histogram({
    name: "strata_agent_cycle_seconds",
    help: "Quoting cycle latency",
    labelNames: ["market", "outcome"],
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 4, 8],
    registers: [registry],
  });
  const tx = new Counter({ name: "strata_agent_tx_total", help: "batchUpdate results", labelNames: ["market", "result"], registers: [registry] });
  const halts = new Counter({ name: "strata_agent_halts_total", help: "Cycles halted by a guard", labelNames: ["market", "reason"], registers: [registry] });
  const invBase = new Gauge({ name: "strata_agent_inventory_base", help: "Signed position in base units", labelNames: ["market"], registers: [registry] });
  const invUsd = new Gauge({ name: "strata_agent_inventory_usd", help: "Signed position notional in USD", labelNames: ["market"], registers: [registry] });
  const equity = new Gauge({ name: "strata_agent_equity_usd", help: "Account equity in USD", registers: [registry] });
  const pnl = new Gauge({ name: "strata_agent_pnl_usd", help: "Equity change since process start in USD", registers: [registry] });
  const margin = new Gauge({ name: "strata_agent_margin_ratio", help: "Account margin ratio, NaN when flat", registers: [registry] });
  return {
    registry,
    loop: {
      observeCycle: (market, seconds, outcome) => cycle.observe({ market, outcome }, seconds),
      txResult: (market, ok) => tx.inc({ market, result: ok ? "ok" : "error" }),
      halt: (market, reason) => halts.inc({ market, reason }),
      inventory: (market, base, usd) => {
        invBase.set({ market }, base);
        invUsd.set({ market }, usd);
      },
      equity: (usd, pnlUsd) => {
        equity.set(usd);
        pnl.set(pnlUsd);
      },
      marginRatio: (ratio) => margin.set(ratio ?? Number.NaN),
    },
  };
}

export interface ControlServerDeps {
  readonly registry: Registry;
  readonly killSwitch: KillSwitch;
  readonly killToken: string | null;
  readonly owner: Address | null;
  readonly network: NetworkName;
  readonly nonces: NonceStore;
  readonly now: () => number;
  readonly health: () => Record<string, unknown>;
}

const MAX_BODY = 64 * 1024;

class BodyTooLarge extends Error {}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new BodyTooLarge());
        req.resume();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function send(res: ServerResponse, r: HttpResult): void {
  res.writeHead(r.status, { "content-type": "application/json" });
  res.end(JSON.stringify(r.body));
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function createControlServer(d: ControlServerDeps): Server {
  return createServer((req, res) => {
    void (async () => {
      try {
        const path = new URL(req.url ?? "/", "http://localhost").pathname;
        if (req.method === "GET" && path === "/metrics") {
          res.writeHead(200, { "content-type": d.registry.contentType });
          res.end(await d.registry.metrics());
          return;
        }
        if (req.method === "GET" && path === "/healthz") return send(res, { status: 200, body: d.health() });
        if (req.method === "POST" && path === "/internal/kill") {
          const body = parseJson(await readBody(req));
          return send(res, handleInternalKill(req.headers.authorization, body, { token: d.killToken, killSwitch: d.killSwitch, nowMs: d.now() }));
        }
        if (req.method === "POST" && path === "/admin/kill") {
          const body = parseJson(await readBody(req));
          return send(res, await handleSignedKill(body, { owner: d.owner, network: d.network, killSwitch: d.killSwitch, nonces: d.nonces, nowMs: d.now() }));
        }
        send(res, { status: 404, body: { error: "not found" } });
      } catch (err) {
        send(res, err instanceof BodyTooLarge ? { status: 413, body: { error: "body too large" } } : { status: 500, body: { error: "internal error" } });
      }
    })();
  });
}
