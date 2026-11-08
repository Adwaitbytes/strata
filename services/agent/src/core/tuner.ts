/**
 * AI Risk Tuner (PRD 9.7). Bounded AI that never trades:
 * - Every 5 to 15 minutes it sends a compact market snapshot (no addresses, keys or user data) to
 *   Claude and asks for parameter adjustments only, as strict JSON (structured outputs).
 * - The reply is zod-validated, clamped to the @strata/risk hard bounds, and limited to a 20%
 *   change per parameter per step. Invalid output is rejected and logged.
 * - Shadow mode is the default (D10, D29): suggestions are recorded but never applied. Live mode
 *   needs an explicit config request plus a documented, non-negative shadow review (docs/AI_TUNER.md).
 * Every step emits a TunerEvent, applied or not, for the public "why the agent changed its spread" feed.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { NetworkName, SessionState, Side, TunableParams, TunerEvent, TunerMode } from "@strata/sdk";
import { PARAM_BOUNDS, clampValue } from "@strata/risk";

export const DEFAULT_TUNER_MODEL = "claude-opus-5-5";
const MAX_STEP_FRACTION = 0.2;

/* ------------------------------ snapshot and prompt ------------------------------ */

export interface TunerSnapshot {
  readonly market: string;
  readonly sessionState: SessionState;
  readonly realizedVolBps: number;
  readonly fills: { readonly buy: number; readonly sell: number; readonly windowMin: number };
  readonly markoutsBps: { readonly s1: number | null; readonly s10: number | null; readonly s60: number | null } | null;
  readonly inventoryUsd: number;
  readonly inventoryCapUsd: number;
  readonly recentGuardReasons: readonly string[];
  readonly fundingRateHourlyBps: number | null;
  readonly current: TunableParams;
}

const BOUNDS_FOR_PROMPT = {
  gamma: PARAM_BOUNDS.gamma,
  minHalfSpreadBps: PARAM_BOUNDS.minHalfSpreadBps,
  levels: PARAM_BOUNDS.levels,
  sizeMultiplier: PARAM_BOUNDS.sizeMultiplier,
};

const SYSTEM_PROMPT = [
  "You tune risk parameters for an automated market maker on a perpetual futures market.",
  "You never place orders and never predict price. You only suggest the next values of: gamma (inventory risk aversion, 1/bps),",
  "minHalfSpreadBps (minimum half spread), levels (orders per side), sizeMultiplier (order size scale), offHoursQuoting (quote while the underlying is closed).",
  "Each value moves at most 20% per step and stays inside the hard bounds given; larger moves are cut.",
  "Widen or shrink size when markouts are negative (adverse selection), volatility is high, or guards fired recently.",
  "Tighten only when markouts are non-negative and fills are balanced. Prefer small changes; returning the current values is fine.",
  "Return the JSON object only. rationale is one plain sentence under 280 characters explaining the change for a public feed.",
].join(" ");

export function buildTunerPrompt(snapshot: TunerSnapshot): string {
  return `Hard bounds: ${JSON.stringify(BOUNDS_FOR_PROMPT)}\nSnapshot: ${JSON.stringify(snapshot)}`;
}

export const TunerSuggestion = z
  .object({
    gamma: z.number().finite(),
    minHalfSpreadBps: z.number().finite(),
    levels: z.number().int(),
    sizeMultiplier: z.number().finite(),
    offHoursQuoting: z.boolean(),
    rationale: z.string().min(1).max(280),
  })
  .strict();
export type TunerSuggestion = z.infer<typeof TunerSuggestion>;

export const TUNER_OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    gamma: { type: "number" },
    minHalfSpreadBps: { type: "number" },
    levels: { type: "integer" },
    sizeMultiplier: { type: "number" },
    offHoursQuoting: { type: "boolean" },
    rationale: { type: "string" },
  },
  required: ["gamma", "minHalfSpreadBps", "levels", "sizeMultiplier", "offHoursQuoting", "rationale"],
} as const;

/* ------------------------------ client ------------------------------ */

export interface TunerReply {
  readonly text: string | null;
  readonly refused: boolean;
}

export interface TunerClient {
  readonly model: string;
  suggest(snapshot: TunerSnapshot): Promise<TunerReply>;
}

interface MessageLike {
  readonly stop_reason: string | null;
  readonly content: readonly { readonly type: string; readonly text?: string }[];
}

export interface MessagesApi {
  create(params: Anthropic.Beta.MessageCreateParamsNonStreaming): Promise<MessageLike>;
}

export class AnthropicTunerClient implements TunerClient {
  readonly model: string;
  readonly #messages: MessagesApi;

  constructor(opts: { model: string; messages: MessagesApi }) {
    this.model = opts.model;
    this.#messages = opts.messages;
  }

  async suggest(snapshot: TunerSnapshot): Promise<TunerReply> {
    const res = await this.#messages.create({
      model: this.model,
      max_tokens: 16_000,
      // Server-side fallback keeps the tuner answering if the primary model declines.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: { type: "json_schema", schema: TUNER_OUTPUT_SCHEMA } },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildTunerPrompt(snapshot) }],
    });
    if (res.stop_reason === "refusal") return { text: null, refused: true };
    const text = res.content.find((b) => b.type === "text")?.text ?? null;
    return { text, refused: false };
  }
}

export function createAnthropicTunerClient(apiKey: string, model: string): AnthropicTunerClient {
  const anthropic = new Anthropic({ apiKey, timeout: 120_000, maxRetries: 2 });
  return new AnthropicTunerClient({ model, messages: { create: (p) => anthropic.beta.messages.create(p) } });
}

/* ------------------------------ bounding ------------------------------ */

function stepLimit(from: number, to: number, integer: boolean): number {
  const maxDelta = integer ? Math.max(1, Math.round(Math.abs(from) * MAX_STEP_FRACTION)) : Math.abs(from) * MAX_STEP_FRACTION;
  return Math.min(from + maxDelta, Math.max(from - maxDelta, to));
}

export function boundSuggestion(current: TunableParams, suggested: TunableParams): { applied: TunableParams; clamped: string[] } {
  const clamped: string[] = [];
  const numeric = (key: "gamma" | "minHalfSpreadBps" | "levels" | "sizeMultiplier"): number => {
    const integer = PARAM_BOUNDS[key].integer === true;
    const v = clampValue(key, stepLimit(current[key], suggested[key], integer));
    if (Math.abs(v - suggested[key]) > 1e-12) clamped.push(key);
    return v;
  };
  // The tuner may switch off-hours quoting off (less risk), never on; turning it on is a human decision.
  const offHoursQuoting = current.offHoursQuoting && suggested.offHoursQuoting;
  if (offHoursQuoting !== suggested.offHoursQuoting) clamped.push("offHoursQuoting");
  return {
    applied: { gamma: numeric("gamma"), minHalfSpreadBps: numeric("minHalfSpreadBps"), levels: numeric("levels"), sizeMultiplier: numeric("sizeMultiplier"), offHoursQuoting },
    clamped,
  };
}

/* ------------------------------ step ------------------------------ */

export interface TunerStepInput {
  readonly client: TunerClient;
  readonly snapshot: TunerSnapshot;
  readonly current: TunableParams;
  readonly mode: Exclude<TunerMode, "static">;
  readonly network: NetworkName;
  readonly agentId: number;
  readonly marketId: string;
  readonly id: string;
  readonly at: number;
}

export async function runTunerStep(input: TunerStepInput): Promise<{ event: TunerEvent; next: TunableParams }> {
  const base = {
    network: input.network,
    id: input.id,
    agentId: input.agentId,
    marketId: input.marketId,
    mode: input.mode,
    model: input.client.model,
    before: input.current,
    at: input.at,
  };
  const reject = (reason: string, suggested: TunableParams = input.current, rationale = "Suggestion rejected; parameters unchanged.") => ({
    event: { ...base, suggested, applied: null, clamped: [], rationale, rejected: true, rejectReason: reason } satisfies TunerEvent,
    next: input.current,
  });

  let reply: TunerReply;
  try {
    reply = await input.client.suggest(input.snapshot);
  } catch (err) {
    return reject(`api error: ${err instanceof Error ? err.constructor.name : "unknown"}`);
  }
  if (reply.refused) return reject("model refused");
  if (reply.text === null || reply.text.trim() === "") return reject("empty response");
  let json: unknown;
  try {
    json = JSON.parse(reply.text);
  } catch {
    return reject("invalid JSON");
  }
  const parsed = TunerSuggestion.safeParse(json);
  if (!parsed.success) return reject(`schema violation: ${parsed.error.issues.map((i) => i.path.join(".") || i.code).join(", ")}`.slice(0, 200));
  const { rationale, ...suggested } = parsed.data;
  const { applied, clamped } = boundSuggestion(input.current, suggested);
  return {
    event: { ...base, suggested, applied, clamped, rationale, rejected: false, rejectReason: null },
    next: input.mode === "live" ? applied : input.current,
  };
}

/* ------------------------------ mode ------------------------------ */

/** Evidence that shadow results were reviewed (PRD 9.7: live only after non-negative shadow results). */
export const ShadowReview = z.object({
  approvedBy: z.string().min(1),
  approvedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  reportRef: z.string().startsWith("docs/AI_TUNER.md"),
  shadowPnlDeltaUsd: z.number(),
});
export type ShadowReview = z.infer<typeof ShadowReview>;

export function resolveTunerMode(
  cfg: { requested: "off" | "shadow" | "live"; shadowReview: ShadowReview | null },
  hasApiKey: boolean,
): "off" | "shadow" | "live" {
  if (!hasApiKey || cfg.requested === "off") return "off";
  if (cfg.requested === "live" && cfg.shadowReview !== null && cfg.shadowReview.shadowPnlDeltaUsd >= 0) return "live";
  return "shadow";
}

/* ------------------------------ secrets ------------------------------ */

/**
 * Secret lookup: `NAME` env var, else `<secretsDir>/<name>` (default `.secrets`, D29). The value is
 * returned to the caller only; it is never logged.
 */
export function readSecret(name: string, env: Readonly<Record<string, string | undefined>> = process.env, secretsDir = env["SECRETS_DIR"] ?? ".secrets"): string | null {
  const fromEnv = env[name.toUpperCase()]?.trim();
  if (fromEnv) return fromEnv;
  try {
    const fromFile = readFileSync(join(secretsDir, name), "utf8").trim();
    return fromFile === "" ? null : fromFile;
  } catch {
    return null;
  }
}

/* ------------------------------ markouts ------------------------------ */

const HORIZONS = [
  ["s1", 1_000],
  ["s10", 10_000],
  ["s60", 60_000],
] as const;

interface TrackedFill {
  readonly side: Side;
  readonly price: number;
  readonly at: number;
  s1: number | null;
  s10: number | null;
  s60: number | null;
}

/** Markout = signed mid move after a fill, in bps, positive when the fill was profitable. */
export class MarkoutTracker {
  #fills: TrackedFill[] = [];

  addFill(side: Side, price: number, at: number): void {
    this.#fills.push({ side, price, at, s1: null, s10: null, s60: null });
  }

  observeMid(mid: number, at: number): void {
    for (const f of this.#fills) {
      for (const [key, h] of HORIZONS) {
        if (f[key] === null && at >= f.at + h) f[key] = (f.side === "buy" ? 1 : -1) * ((mid - f.price) / f.price) * 1e4;
      }
    }
  }

  summary(nowMs: number, windowMs: number): { s1: number | null; s10: number | null; s60: number | null } | null {
    this.#fills = this.#fills.filter((f) => nowMs - f.at <= Math.max(windowMs, 120_000));
    const recent = this.#fills.filter((f) => nowMs - f.at <= windowMs);
    if (recent.length === 0) return null;
    const avg = (key: "s1" | "s10" | "s60"): number | null => {
      const xs = recent.map((f) => f[key]).filter((v): v is number => v !== null);
      return xs.length === 0 ? null : Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 + 0;
    };
    return { s1: avg("s1"), s10: avg("s10"), s60: avg("s60") };
  }
}
