/**
 * Kill switch (PRD 9.6, 16.4). Three sources, one latch:
 *   (a) Telegram `/kill <agent|all>`: the bot in packages/alerts (W9) checks the owner chat
 *       whitelist and calls this agent's `POST /internal/kill` with a shared bearer token.
 *   (b) Signed admin request (@strata/sdk KillRequest): EIP-191 signature by the owner wallet,
 *       verified with viem `verifyMessage`, single-use nonce, bounded expiry.
 *   (c) Env flag `KILL_SWITCH=true` at startup.
 * Once killed the agent cancels every order, optionally closes positions reduce-only, and stays
 * halted until a human restarts it. There is no remote resume.
 */
import { timingSafeEqual } from "node:crypto";
import { isAddress, verifyMessage, type Address, type Hex } from "viem";
import { z } from "zod";
import { KillRequest, killRequestMessage, type NetworkName } from "@strata/sdk";
import type { GuardDecision } from "@strata/risk";

export type KillSource = "telegram" | "api" | "env";

export interface KillCommand {
  readonly target: "all" | number | string;
  readonly closePositions: boolean;
  readonly source: KillSource;
  readonly at: number;
}

export interface KillState {
  readonly killed: boolean;
  readonly closePositions: boolean;
  readonly source: KillSource | null;
  readonly at: number | null;
}

export class KillSwitch {
  readonly #agentId: number;
  readonly #agentName: string;
  #state: KillState = { killed: false, closePositions: false, source: null, at: null };
  readonly #listeners = new Set<(s: KillState) => void>();

  /** `restored` is the persisted latch (review H-2): a kill survives restarts until a human clears it. */
  constructor(identity: { agentId: number; agentName: string }, restored: KillState | null = null) {
    this.#agentId = identity.agentId;
    this.#agentName = identity.agentName;
    if (restored !== null) this.#state = { ...restored };
  }

  get state(): KillState {
    return this.#state;
  }

  /** Returns true when the command targets this agent. Killing is idempotent and never reverses. */
  trigger(cmd: KillCommand): boolean {
    const applies = cmd.target === "all" || cmd.target === this.#agentId || cmd.target === this.#agentName;
    if (!applies) return false;
    const first = !this.#state.killed;
    this.#state = {
      killed: true,
      closePositions: this.#state.closePositions || cmd.closePositions,
      source: this.#state.source ?? cmd.source,
      at: this.#state.at ?? cmd.at,
    };
    if (first) for (const l of this.#listeners) l(this.#state);
    return true;
  }

  onKill(listener: (s: KillState) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  decision(): GuardDecision | null {
    const s = this.#state;
    if (!s.killed || s.source === null) return null;
    return {
      guard: "kill_switch",
      action: "halt",
      reason: `kill_switch_${s.source}`,
      detail: `Kill switch triggered via ${s.source}; all orders cancelled${s.closePositions ? " and a reduce-only close requested" : ""}.`,
      observed: { source: s.source, closePositions: s.closePositions },
    };
  }
}

/* ------------------------------ (c) env flag ------------------------------ */

const TRUE = new Set(["true", "1", "yes"]);

export function killFromEnv(env: Readonly<Record<string, string | undefined>>, nowMs: number): KillCommand | null {
  if (!TRUE.has((env["KILL_SWITCH"] ?? "").trim().toLowerCase())) return null;
  return { target: "all", closePositions: TRUE.has((env["KILL_SWITCH_CLOSE"] ?? "").trim().toLowerCase()), source: "env", at: nowMs };
}

/* ------------------------------ (b) signed admin request ------------------------------ */


/** Canonical signed text lives in @strata/sdk so the API and the agent can never disagree (review M-4). */
export { killRequestMessage };

export interface NonceStore {
  /** Atomically marks a nonce used. Returns false when it was already used. */
  consume(nonce: string, expiresAt: number, nowMs: number): Promise<boolean>;
}

/** Process-local store; nonces only need to outlive their request expiry. */
export class MemoryNonceStore implements NonceStore {
  readonly #used = new Map<string, number>();

  get size(): number {
    return this.#used.size;
  }

  async consume(nonce: string, expiresAt: number, nowMs: number): Promise<boolean> {
    for (const [n, exp] of this.#used) if (exp < nowMs) this.#used.delete(n);
    if (this.#used.has(nonce)) return false;
    this.#used.set(nonce, expiresAt);
    return true;
  }
}

export interface VerifyOptions {
  readonly owner: Address;
  readonly network: NetworkName;
  readonly nowMs: number;
  readonly nonces: NonceStore;
  /** Longest accepted lifetime of a request. */
  readonly maxTtlMs?: number;
}

export type VerifyResult = { readonly ok: true; readonly request: KillRequest } | { readonly ok: false; readonly error: string };

export async function verifyKillRequest(raw: unknown, opts: VerifyOptions): Promise<VerifyResult> {
  const parsed = KillRequest.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "malformed request" };
  const req = parsed.data;
  if (req.network !== opts.network) return { ok: false, error: "wrong network" };
  if (req.expiresAt <= opts.nowMs) return { ok: false, error: "request expired" };
  if (req.expiresAt - opts.nowMs > (opts.maxTtlMs ?? 10 * 60_000)) return { ok: false, error: "expiry too far in the future" };
  const { signature, ...unsigned } = req;
  let valid = false;
  try {
    valid = await verifyMessage({ address: opts.owner, message: killRequestMessage(unsigned), signature: signature as Hex });
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, error: "bad signature" };
  // Consume only after the signature checks out, so nobody can burn the owner's nonces.
  if (!(await opts.nonces.consume(req.nonce, req.expiresAt, opts.nowMs))) return { ok: false, error: "nonce already used" };
  return { ok: true, request: req };
}

export function parseOwnerAddress(raw: string | undefined): Address | null {
  const v = raw?.trim();
  return v && isAddress(v) ? v : null;
}

/* ------------------------------ HTTP handlers ------------------------------ */

export interface HttpResult {
  readonly status: number;
  readonly body: Record<string, unknown>;
}

/** Body sent by packages/alerts KillDispatcher (W9). */
export const InternalKillBody = z.object({ closePositions: z.boolean(), source: z.literal("telegram"), requestedAt: z.number().int().positive() }).strict();

function bearerMatches(header: string | undefined, token: string): boolean {
  if (header === undefined || !header.startsWith("Bearer ")) return false;
  const presented = Buffer.from(header.slice("Bearer ".length));
  const expected = Buffer.from(token);
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

export function handleInternalKill(
  authorization: string | undefined,
  body: unknown,
  deps: { token: string | null; killSwitch: KillSwitch; nowMs: number },
): HttpResult {
  if (deps.token === null) return { status: 503, body: { error: "internal kill endpoint not configured" } };
  if (!bearerMatches(authorization, deps.token)) return { status: 401, body: { error: "unauthorized" } };
  const parsed = InternalKillBody.safeParse(body);
  if (!parsed.success) return { status: 400, body: { error: "malformed request" } };
  deps.killSwitch.trigger({ target: "all", closePositions: parsed.data.closePositions, source: "telegram", at: deps.nowMs });
  return { status: 202, body: { killed: true } };
}

export async function handleSignedKill(
  body: unknown,
  deps: { owner: Address | null; network: NetworkName; killSwitch: KillSwitch; nonces: NonceStore; nowMs: number },
): Promise<HttpResult> {
  if (deps.owner === null) return { status: 503, body: { error: "admin owner address not configured" } };
  const v = await verifyKillRequest(body, { owner: deps.owner, network: deps.network, nowMs: deps.nowMs, nonces: deps.nonces });
  if (!v.ok) return { status: 401, body: { error: v.error } };
  const applied = deps.killSwitch.trigger({ target: v.request.target, closePositions: v.request.closePositions, source: "api", at: deps.nowMs });
  return applied ? { status: 202, body: { killed: true } } : { status: 200, body: { applied: false } };
}

/* ------------------------------ signals ------------------------------ */

export interface SignalTarget {
  once(signal: "SIGTERM" | "SIGINT", listener: () => void): unknown;
}

export interface ShutdownOptions {
  /** Exit 1 if shutdown has not finished by then (a dead database or RPC must not hang the exit). */
  forceExitMs?: number;
}

/**
 * SIGTERM/SIGINT: cancel every order first, then exit. A second signal does not start a second
 * shutdown. Returns fail(code), the same once-guarded path for fatal errors: cancel all, exit code.
 */
export function installShutdownHandlers(
  proc: SignalTarget,
  shutdown: () => Promise<void>,
  exit: (code: number) => void,
  options: ShutdownOptions = {},
): (code: number) => void {
  let started = false;
  const run = (code: number): void => {
    if (started) return;
    started = true;
    const force = options.forceExitMs === undefined ? null : setTimeout(() => exit(1), options.forceExitMs);
    shutdown().then(
      () => (force !== null && clearTimeout(force), exit(code)),
      () => (force !== null && clearTimeout(force), exit(1)),
    );
  };
  proc.once("SIGTERM", () => run(0));
  proc.once("SIGINT", () => run(0));
  return run;
}

export interface FatalTarget {
  on(event: "unhandledRejection" | "uncaughtException", listener: (err: unknown) => void): unknown;
}

/**
 * Cancel-on-uncertainty: an error nothing handled means state is unknown, so log it, cancel every
 * order and exit 1 for a clean supervised restart instead of dying mid-batch with orders resting.
 */
export function installFatalHandlers(
  proc: FatalTarget,
  fail: (code: number) => void,
  log: (kind: "unhandledRejection" | "uncaughtException", err: unknown) => void,
): void {
  for (const kind of ["unhandledRejection", "uncaughtException"] as const) {
    proc.on(kind, (err) => {
      log(kind, err);
      fail(1);
    });
  }
}
