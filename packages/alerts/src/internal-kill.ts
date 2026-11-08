import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { z } from "zod";
import type { FetchLike } from "./telegram.js";

/**
 * Contract between the Telegram bot container and each agent container.
 *
 * Agents serve `POST /internal/kill` on their metrics port (default 9464). That port is
 * reachable only on the private compose network; it is never published to the host. The
 * request carries `Authorization: Bearer <token>` where the token is the shared secret in
 * `.secrets/internal_kill_token`. On a valid request the agent must cancel all orders,
 * optionally close positions reduce-only, record a GuardEvent with reason
 * `kill_switch_telegram`, stay halted until restarted, and answer 202.
 */
export const INTERNAL_KILL_PATH = "/internal/kill";
export const DEFAULT_KILL_TOKEN_FILE = "/run/secrets/internal_kill_token";
const MIN_TOKEN_CHARS = 32;

export const InternalKillRequest = z
  .object({
    closePositions: z.boolean(),
    source: z.literal("telegram"),
    requestedAt: z.number().int().positive(),
  })
  .strict();
export type InternalKillRequest = z.infer<typeof InternalKillRequest>;

export function loadKillToken(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const path = env.INTERNAL_KILL_TOKEN_FILE ?? DEFAULT_KILL_TOKEN_FILE;
  const token = readFileSync(path, "utf8").trim();
  if (token.length < MIN_TOKEN_CHARS) throw new Error(`internal kill token in ${path} is shorter than ${MIN_TOKEN_CHARS} chars`);
  return token;
}

/** Constant-time bearer check for the agent side. */
export function isAuthorizedKillRequest(authorizationHeader: string | undefined, token: string): boolean {
  if (authorizationHeader === undefined || !authorizationHeader.startsWith("Bearer ")) return false;
  const presented = Buffer.from(authorizationHeader.slice("Bearer ".length));
  const expected = Buffer.from(token);
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

/** `strata-test-1=http://agent-test-1:9464,strata-test-2=http://agent-test-2:9464` */
export function parseAgentEndpoints(raw: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const pair of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    const eq = pair.indexOf("=");
    if (eq <= 0) throw new Error(`agent endpoint entry must be name=url: ${pair}`);
    const name = pair.slice(0, eq).trim();
    const url = new URL(pair.slice(eq + 1).trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error(`unsupported protocol for ${name}`);
    if (out.has(name)) throw new Error(`duplicate agent endpoint: ${name}`);
    out.set(name, url.origin);
  }
  return out;
}

export type DispatchOutcome = { readonly agent: string; readonly ok: boolean; readonly detail: string };

export class KillDispatcher {
  readonly #endpoints: ReadonlyMap<string, string>;
  readonly #token: string;
  readonly #fetch: FetchLike;
  readonly #timeoutMs: number;

  constructor(opts: { endpoints: ReadonlyMap<string, string>; token: string; fetch?: FetchLike; timeoutMs?: number }) {
    this.#endpoints = opts.endpoints;
    this.#token = opts.token;
    this.#fetch = opts.fetch ?? ((input, init) => fetch(input, init));
    this.#timeoutMs = opts.timeoutMs ?? 5_000;
  }

  get agents(): string[] {
    return [...this.#endpoints.keys()];
  }

  /** Fans out in parallel; one unreachable agent never blocks killing the others. */
  async kill(target: "all" | string, closePositions: boolean, nowMs: number): Promise<DispatchOutcome[]> {
    const names = target === "all" ? this.agents : [target];
    const body: InternalKillRequest = { closePositions, source: "telegram", requestedAt: nowMs };
    return Promise.all(
      names.map(async (agent): Promise<DispatchOutcome> => {
        const base = this.#endpoints.get(agent);
        if (base === undefined) return { agent, ok: false, detail: "unknown agent" };
        try {
          const res = await this.#fetch(`${base}${INTERNAL_KILL_PATH}`, {
            method: "POST",
            headers: { "content-type": "application/json", authorization: `Bearer ${this.#token}` },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(this.#timeoutMs),
          });
          return { agent, ok: res.status === 202 || res.status === 200, detail: `HTTP ${res.status}` };
        } catch (err) {
          return { agent, ok: false, detail: err instanceof Error ? err.name : "request failed" };
        }
      }),
    );
  }

  async status(): Promise<DispatchOutcome[]> {
    return Promise.all(
      this.agents.map(async (agent): Promise<DispatchOutcome> => {
        try {
          const res = await this.#fetch(`${this.#endpoints.get(agent)!}/healthz`, {
            method: "GET",
            signal: AbortSignal.timeout(this.#timeoutMs),
          });
          return { agent, ok: res.ok, detail: `HTTP ${res.status}` };
        } catch (err) {
          return { agent, ok: false, detail: err instanceof Error ? err.name : "request failed" };
        }
      }),
    );
  }
}
