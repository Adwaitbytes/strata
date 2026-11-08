import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TunerEvent, type TunableParams } from "@strata/sdk";
import { DEFAULT_PARAMS, PARAM_BOUNDS } from "@strata/risk";
import {
  AnthropicTunerClient,
  MarkoutTracker,
  TUNER_OUTPUT_SCHEMA,
  boundSuggestion,
  buildTunerPrompt,
  readSecret,
  resolveTunerMode,
  runTunerStep,
  type TunerClient,
  type TunerSnapshot,
} from "./tuner.js";

const M = `0x${"a".repeat(64)}`;
const current: TunableParams = { gamma: 0.1, minHalfSpreadBps: 10, levels: 3, sizeMultiplier: 1, offHoursQuoting: false };
const snapshot: TunerSnapshot = {
  market: "XAU/USDC PERP",
  sessionState: "open",
  realizedVolBps: 1.2,
  fills: { buy: 4, sell: 6, windowMin: 15 },
  markoutsBps: { s1: -0.4, s10: -1.1, s60: 0.3 },
  inventoryUsd: 42,
  inventoryCapUsd: 200,
  recentGuardReasons: ["session_pre_close"],
  fundingRateHourlyBps: 0.8,
  current,
};
const ctx = { network: "testnet" as const, agentId: 2, marketId: M, id: "tuner-1", at: 1_780_000_000_000 };

const stub = (text: string | null, opts: { refused?: boolean; throws?: Error } = {}): TunerClient => ({
  model: "stub-model",
  suggest: vi.fn(async () => {
    if (opts.throws) throw opts.throws;
    return { text, refused: opts.refused ?? false };
  }),
});
const reply = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ gamma: 0.11, minHalfSpreadBps: 11, levels: 3, sizeMultiplier: 1, offHoursQuoting: false, rationale: "Markouts are negative at 10 s, so widen slightly.", ...over });

describe("boundSuggestion", () => {
  it("limits each step to 20% and clamps to hard bounds", () => {
    const { applied, clamped } = boundSuggestion(current, { gamma: 1, minHalfSpreadBps: 2, levels: 9, sizeMultiplier: 1.1, offHoursQuoting: false });
    expect(applied.gamma).toBeCloseTo(0.12, 10);
    expect(applied.minHalfSpreadBps).toBeCloseTo(8, 10);
    expect(applied.levels).toBe(4);
    expect(applied.sizeMultiplier).toBeCloseTo(1.1, 10);
    expect(clamped.sort()).toEqual(["gamma", "levels", "minHalfSpreadBps"]);
  });

  it("never exceeds PARAM_BOUNDS even from an out-of-bounds start", () => {
    const { applied } = boundSuggestion({ ...current, gamma: 4.9, sizeMultiplier: 5 }, { ...current, gamma: 100, sizeMultiplier: 100 });
    expect(applied.gamma).toBe(PARAM_BOUNDS.gamma.max);
    expect(applied.sizeMultiplier).toBe(PARAM_BOUNDS.sizeMultiplier.max);
  });

  it("may switch off-hours quoting off but never on", () => {
    expect(boundSuggestion({ ...current, offHoursQuoting: true }, { ...current, offHoursQuoting: false }).applied.offHoursQuoting).toBe(false);
    const on = boundSuggestion(current, { ...current, offHoursQuoting: true });
    expect(on.applied.offHoursQuoting).toBe(false);
    expect(on.clamped).toContain("offHoursQuoting");
  });
});

describe("runTunerStep", () => {
  it("shadow mode logs the bounded suggestion but keeps the current params", async () => {
    const { event, next } = await runTunerStep({ client: stub(reply()), snapshot, current, mode: "shadow", ...ctx });
    expect(TunerEvent.parse(event)).toEqual(event);
    expect(event).toMatchObject({ mode: "shadow", model: "stub-model", rejected: false, rejectReason: null });
    expect(event.applied).toMatchObject({ gamma: 0.11, minHalfSpreadBps: 11 });
    expect(next).toEqual(current);
  });

  it("live mode returns the bounded values as the next params", async () => {
    const { event, next } = await runTunerStep({ client: stub(reply({ gamma: 0.5 })), snapshot, current, mode: "live", ...ctx });
    expect(next.gamma).toBeCloseTo(0.12, 10);
    expect(event.clamped).toEqual(["gamma"]);
  });

  it("rejects invalid JSON, schema violations, refusals and API errors without changing params", async () => {
    const cases: [TunerClient, RegExp][] = [
      [stub("not json"), /invalid JSON/],
      [stub(reply({ levels: 2.5 })), /schema/],
      [stub(reply({ extra: 1 })), /schema/],
      [stub(reply({ rationale: "x".repeat(400) })), /schema/],
      [stub(null, { refused: true }), /refused/],
      [stub(null), /empty/],
      [stub(null, { throws: new Error("socket hang up") }), /api error/],
    ];
    for (const [client, re] of cases) {
      const { event, next } = await runTunerStep({ client, snapshot, current, mode: "live", ...ctx });
      expect(event.rejected).toBe(true);
      expect(event.rejectReason).toMatch(re);
      expect(event.applied).toBeNull();
      expect(next).toEqual(current);
      expect(TunerEvent.safeParse(event).success).toBe(true);
    }
  });
});

describe("prompt and schema", () => {
  it("contains only the compact snapshot: no addresses, keys or user data", () => {
    const prompt = buildTunerPrompt(snapshot);
    expect(prompt).toContain("XAU/USDC PERP");
    expect(prompt).toContain('"realizedVolBps":1.2');
    expect(prompt).not.toMatch(/0x[0-9a-fA-F]{40}/);
    expect(prompt).not.toMatch(/inj1/);
    expect(prompt).not.toMatch(/sk-ant/);
  });

  it("output schema is strict", () => {
    expect(TUNER_OUTPUT_SCHEMA).toMatchObject({ type: "object", additionalProperties: false });
    expect(TUNER_OUTPUT_SCHEMA.required).toEqual(["gamma", "minHalfSpreadBps", "levels", "sizeMultiplier", "offHoursQuoting", "rationale"]);
  });
});

describe("AnthropicTunerClient", () => {
  it("sends a structured-output request on the configured model and reads the text block", async () => {
    const create = vi.fn(async () => ({ stop_reason: "end_turn", content: [{ type: "thinking", thinking: "" }, { type: "text", text: reply() }] }));
    const client = new AnthropicTunerClient({ model: "claude-opus-5-5", messages: { create } });
    const res = await client.suggest(snapshot);
    expect(res).toEqual({ text: reply(), refused: false });
    const call = (create.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(call).toMatchObject({ model: "claude-opus-5-5", output_config: { effort: "medium", format: { type: "json_schema" } }, fallbacks: "default" });
    expect(JSON.stringify(call)).not.toContain("0x");
  });

  it("reports refusals", async () => {
    const create = vi.fn(async () => ({ stop_reason: "refusal", content: [] }));
    const client = new AnthropicTunerClient({ model: "m", messages: { create } });
    expect(await client.suggest(snapshot)).toEqual({ text: null, refused: true });
  });
});

describe("mode resolution (D10, D29, shadow first)", () => {
  const review = { approvedBy: "owner", approvedOn: "2026-11-20", reportRef: "docs/AI_TUNER.md#shadow-results", shadowPnlDeltaUsd: 3.2 };
  it("is off without a key and shadow by default with one", () => {
    expect(resolveTunerMode({ requested: "shadow", shadowReview: null }, false)).toBe("off");
    expect(resolveTunerMode({ requested: "shadow", shadowReview: null }, true)).toBe("shadow");
    expect(resolveTunerMode({ requested: "off", shadowReview: null }, true)).toBe("off");
  });
  it("needs a documented, non-negative shadow review to go live", () => {
    expect(resolveTunerMode({ requested: "live", shadowReview: null }, true)).toBe("shadow");
    expect(resolveTunerMode({ requested: "live", shadowReview: { ...review, shadowPnlDeltaUsd: -1 } }, true)).toBe("shadow");
    expect(resolveTunerMode({ requested: "live", shadowReview: review }, true)).toBe("live");
  });
});

describe("secrets", () => {
  it("reads from env first, then the secrets file, never returning blanks", () => {
    const dir = mkdtempSync(join(tmpdir(), "strata-secrets-"));
    writeFileSync(join(dir, "anthropic_api_key"), "  file-value\n");
    expect(readSecret("anthropic_api_key", { ANTHROPIC_API_KEY: "env-value" }, dir)).toBe("env-value");
    expect(readSecret("anthropic_api_key", {}, dir)).toBe("file-value");
    expect(readSecret("missing_secret", {}, dir)).toBeNull();
    writeFileSync(join(dir, "blank"), "\n");
    expect(readSecret("blank", { BLANK: " " }, dir)).toBeNull();
  });
});

describe("MarkoutTracker", () => {
  it("measures signed markouts at 1 s, 10 s and 60 s", () => {
    const t = new MarkoutTracker();
    t.addFill("buy", 100, 0);
    t.addFill("sell", 100, 0);
    t.observeMid(100.01, 1_000);
    t.observeMid(99.9, 10_000);
    t.observeMid(100.2, 60_000);
    const m = t.summary(60_000, 15 * 60_000);
    // buy: +1, -10, +20 bps; sell: -1, +10, -20 bps -> averages 0
    expect(m).toEqual({ s1: 0, s10: 0, s60: 0 });
    expect(new MarkoutTracker().summary(0, 1)).toBeNull();
    const one = new MarkoutTracker();
    one.addFill("buy", 100, 0);
    one.observeMid(101, 2_000);
    expect(one.summary(2_000, 60_000)).toEqual({ s1: 100, s10: null, s60: null });
  });
});

describe("defaults", () => {
  it("default tunable params come from @strata/risk", () => {
    expect(DEFAULT_PARAMS.levels).toBe(3);
  });
});
