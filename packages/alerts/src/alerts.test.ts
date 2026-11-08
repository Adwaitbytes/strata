import { describe, expect, it, vi } from "vitest";
import { TelegramAlerter, LogOnlyAlerter, createAlerter, type AlertLogger } from "./alerter.js";
import { alertKey, formatAlert, sanitizeErrorText, type Alert } from "./alerts.js";
import { CommandBot } from "./bot.js";
import { isAuthorized, parseCommand } from "./commands.js";
import { loadTelegramConfig, parseChatIds } from "./config.js";
import { TxFailureTracker, checkDataLag } from "./detectors.js";
import { KillDispatcher, isAuthorizedKillRequest, parseAgentEndpoints, InternalKillRequest } from "./internal-kill.js";
import { TelegramClient, type FetchLike, type TelegramMessage } from "./telegram.js";

const TOKEN = "123456789:AAH_example_token_value_for_tests_only_xyz";
const silent = (): AlertLogger & { info: () => void } => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() });
const okJson = (result: unknown = true): Response => new Response(JSON.stringify({ ok: true, result }), { status: 200 });
const halt: Alert = { kind: "agent_halt", network: "testnet", agent: "strata-test-1", reason: "oracle_stale", detail: "oracle age 41s > 30s" };

describe("config", () => {
  const files = (map: Record<string, string>) => (p: string) => map[p] ?? null;

  it("is not_configured when nothing is set", () => {
    expect(loadTelegramConfig({}, files({}))).toEqual({ ok: false, reason: "not_configured" });
  });
  it("reads token and chat ids from secret files", () => {
    const r = loadTelegramConfig({}, files({ "/run/secrets/telegram_bot_token": `${TOKEN}\n`, "/run/secrets/telegram_chat_ids": "111, -100222\n111" }));
    expect(r).toEqual({ ok: true, config: { botToken: TOKEN, chatIds: ["111", "-100222"] } });
  });
  it("falls back to env for local runs", () => {
    const r = loadTelegramConfig({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_OWNER_CHAT_IDS: "42" }, files({}));
    expect(r.ok).toBe(true);
  });
  it("rejects a malformed token without echoing it", () => {
    const r = loadTelegramConfig({ TELEGRAM_BOT_TOKEN: "secret-but-wrong", TELEGRAM_OWNER_CHAT_IDS: "1" }, files({}));
    expect(r).toMatchObject({ ok: false, reason: "invalid" });
    expect(JSON.stringify(r)).not.toContain("secret-but-wrong");
  });
  it("rejects half configuration and bad chat ids", () => {
    expect(loadTelegramConfig({ TELEGRAM_BOT_TOKEN: TOKEN }, files({}))).toMatchObject({ reason: "invalid" });
    expect(loadTelegramConfig({ TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_OWNER_CHAT_IDS: "abc" }, files({}))).toMatchObject({ reason: "invalid" });
  });
  it("parses mixed separators", () => {
    expect(parseChatIds("1,2\n3  4")).toEqual(["1", "2", "3", "4"]);
  });
});

describe("formatting", () => {
  it("covers every alert kind with plain text and no long dash", () => {
    const at = new Date("2026-11-09T00:00:00Z");
    const alerts: Alert[] = [
      halt,
      { kind: "daily_loss_limit", network: "mainnet", agent: "strata-atlas", lossUsd: 50.5, limitUsd: 50 },
      { kind: "tx_failure_spike", network: "testnet", service: "agent", failures: 4, total: 10, windowSec: 300, lastError: "nonce too low" },
      { kind: "epoch_post_failure", network: "testnet", season: 0, epoch: 12, attempt: 3, error: "gas" },
      { kind: "data_lag", network: "testnet", source: "indexer:book", lagSec: 75.4, thresholdSec: 60 },
    ];
    for (const a of alerts) {
      const text = formatAlert(a, at);
      expect(text).toMatch(/^STRATA (TESTNET|MAINNET): /);
      expect(text).not.toContain("\u2014");
    }
    expect(formatAlert(alerts[2]!, at)).toContain("Failed: 4 of 10 (40%)");
    expect(formatAlert(alerts[4]!, at)).toContain("Lag: 75s");
  });
  it("redacts token shaped strings and caps length", () => {
    expect(sanitizeErrorText(`fetch https://api.telegram.org/bot${TOKEN}/send failed`)).not.toContain("AAH_example");
    expect(sanitizeErrorText("x".repeat(1000)).length).toBeLessThan(320);
  });
  it("keys by condition, not by message text", () => {
    expect(alertKey(halt)).toBe(alertKey({ ...halt, detail: "different text" }));
    expect(alertKey(halt)).not.toBe(alertKey({ ...halt, reason: "risk_daily_loss" }));
  });
});

describe("TelegramAlerter", () => {
  const config = { botToken: TOKEN, chatIds: ["1", "2"] };

  it("sends to every owner chat and throttles repeats", async () => {
    const fetch = vi.fn<FetchLike>(() => Promise.resolve(okJson()));
    let now = 1_000_000;
    const alerter = new TelegramAlerter({ config, logger: silent(), fetch, now: () => now, cooldownMs: 60_000 });
    expect(await alerter.notify(halt)).toEqual({ status: "sent", chats: 2 });
    expect(await alerter.notify(halt)).toEqual({ status: "throttled" });
    now += 61_000;
    expect(await alerter.notify(halt)).toEqual({ status: "sent", chats: 2 });
    expect(fetch).toHaveBeenCalledTimes(4);
    const body = JSON.parse(String(fetch.mock.calls[0]![1].body)) as Record<string, unknown>;
    expect(body).toMatchObject({ chat_id: "1" });
    expect(body).not.toHaveProperty("parse_mode");
  });

  it("retries 429 honoring retry_after, then succeeds", async () => {
    const responses = [
      new Response(JSON.stringify({ ok: false, error_code: 429, description: "Too Many Requests", parameters: { retry_after: 2 } }), { status: 429 }),
      okJson(),
    ];
    const fetch = vi.fn<FetchLike>(() => Promise.resolve(responses.shift()!));
    const sleep = vi.fn((_ms: number) => Promise.resolve());
    const alerter = new TelegramAlerter({ config: { botToken: TOKEN, chatIds: ["1"] }, logger: silent(), fetch, sleep });
    expect(await alerter.notify(halt)).toEqual({ status: "sent", chats: 1 });
    expect(sleep).toHaveBeenCalledWith(2000);
  });

  it("never throws, logs failure, and does not throttle the next attempt after a total failure", async () => {
    const fetch = vi.fn<FetchLike>(() => Promise.reject(new TypeError(`fetch failed for https://api.telegram.org/bot${TOKEN}`)));
    const logger = silent();
    const alerter = new TelegramAlerter({ config: { botToken: TOKEN, chatIds: ["1"] }, logger, fetch, sleep: () => Promise.resolve() });
    const r = await alerter.notify(halt);
    expect(r.status).toBe("failed");
    expect(JSON.stringify(r)).not.toContain(TOKEN);
    expect(logger.error).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledTimes(3);
    expect((await alerter.notify(halt)).status).toBe("failed");
  });

  it("does not retry a 400", async () => {
    const fetch = vi.fn<FetchLike>(() =>
      Promise.resolve(new Response(JSON.stringify({ ok: false, error_code: 400, description: "chat not found" }), { status: 400 })),
    );
    const alerter = new TelegramAlerter({ config: { botToken: TOKEN, chatIds: ["1"] }, logger: silent(), fetch });
    expect(await alerter.notify(halt)).toEqual({ status: "failed", error: "telegram sendMessage failed: chat not found" });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("createAlerter falls back to logs when unconfigured and throws when invalid", async () => {
    const logger = silent();
    const a = createAlerter(logger, { TELEGRAM_BOT_TOKEN_FILE: "/nonexistent/a", TELEGRAM_CHAT_IDS_FILE: "/nonexistent/b" });
    expect(a).toBeInstanceOf(LogOnlyAlerter);
    expect(await a.notify(halt)).toEqual({ status: "logged_only" });
    expect(() =>
      createAlerter(logger, { TELEGRAM_BOT_TOKEN_FILE: "/nonexistent/a", TELEGRAM_CHAT_IDS_FILE: "/nonexistent/b", TELEGRAM_BOT_TOKEN: "bad" }),
    ).toThrow(/invalid/);
  });
});

describe("detectors", () => {
  it("flags a tx failure spike only past min samples and ratio", () => {
    const t = new TxFailureTracker({ network: "testnet", service: "agent:strata-test-1", minSamples: 5, failureRatio: 0.4, windowSec: 60 });
    expect(t.record(false, 0, "boom")).toBeNull();
    expect(t.record(true, 1000)).toBeNull();
    expect(t.record(true, 2000)).toBeNull();
    expect(t.record(true, 3000)).toBeNull();
    expect(t.record(false, 4000)).toMatchObject({ kind: "tx_failure_spike", failures: 2, total: 5, lastError: "boom" });
    // Old failures fall out of the window.
    expect(t.record(true, 63_500)).toBeNull();
  });
  it("data lag triggers strictly above 60s", () => {
    expect(checkDataLag({ network: "testnet", source: "s", lastDataAtMs: 0, nowMs: 60_000 })).toBeNull();
    expect(checkDataLag({ network: "testnet", source: "s", lastDataAtMs: 0, nowMs: 61_000 })).toMatchObject({ kind: "data_lag", lagSec: 61 });
  });
});

describe("commands", () => {
  it("parses kill variants", () => {
    expect(parseCommand("/kill all")).toEqual({ ok: true, command: { kind: "kill", target: "all", closePositions: false } });
    expect(parseCommand("/kill@StrataBot strata-test-2 close")).toEqual({
      ok: true,
      command: { kind: "kill", target: "strata-test-2", closePositions: true },
    });
    expect(parseCommand("/kill")).toMatchObject({ ok: false });
    expect(parseCommand("/kill ../etc")).toMatchObject({ ok: false });
    expect(parseCommand("/kill all now please")).toMatchObject({ ok: false });
    expect(parseCommand("hello")).toBeNull();
    expect(parseCommand("/resume all")).toMatchObject({ ok: false });
  });
  const msg = (chat: number, from: number | null, isBot = false): TelegramMessage => ({
    message_id: 1,
    date: 0,
    chat: { id: chat, type: chat < 0 ? "group" : "private" },
    ...(from === null ? {} : { from: { id: from, is_bot: isBot } }),
    text: "/kill all",
  });
  it("authorizes only owner chat plus owner sender", () => {
    expect(isAuthorized(msg(42, 42), ["42"])).toBe(true);
    expect(isAuthorized(msg(-100, 7), ["-100"])).toBe(false);
    expect(isAuthorized(msg(-100, 42), ["-100", "42"])).toBe(true);
    expect(isAuthorized(msg(42, null), ["42"])).toBe(false);
    expect(isAuthorized(msg(42, 42, true), ["42"])).toBe(false);
  });
});

describe("internal kill", () => {
  it("checks the bearer token in constant time semantics", () => {
    const token = "t".repeat(40);
    expect(isAuthorizedKillRequest(`Bearer ${token}`, token)).toBe(true);
    expect(isAuthorizedKillRequest(`Bearer ${token}x`, token)).toBe(false);
    expect(isAuthorizedKillRequest(token, token)).toBe(false);
    expect(isAuthorizedKillRequest(undefined, token)).toBe(false);
  });
  it("parses endpoints strictly", () => {
    expect([...parseAgentEndpoints("a=http://agent-a:9464, b=http://agent-b:9464/x")]).toEqual([
      ["a", "http://agent-a:9464"],
      ["b", "http://agent-b:9464"],
    ]);
    expect(() => parseAgentEndpoints("a=ftp://x")).toThrow();
    expect(() => parseAgentEndpoints("a=http://x,a=http://y")).toThrow(/duplicate/);
    expect(() => parseAgentEndpoints("nourl")).toThrow();
  });
  it("fans out kill to all agents and reports partial failure", async () => {
    const fetch = vi.fn<FetchLike>((url) =>
      url.startsWith("http://a:") ? Promise.resolve(new Response(null, { status: 202 })) : Promise.reject(new Error("ECONNREFUSED")),
    );
    const d = new KillDispatcher({ endpoints: parseAgentEndpoints("a=http://a:9464,b=http://b:9464"), token: "k".repeat(32), fetch });
    const out = await d.kill("all", true, 123);
    expect(out).toEqual([
      { agent: "a", ok: true, detail: "HTTP 202" },
      { agent: "b", ok: false, detail: "Error" },
    ]);
    const init = fetch.mock.calls[0]![1];
    expect(InternalKillRequest.parse(JSON.parse(String(init.body)))).toEqual({ closePositions: true, source: "telegram", requestedAt: 123 });
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${"k".repeat(32)}`);
    expect(await d.kill("zzz", false, 1)).toEqual([{ agent: "zzz", ok: false, detail: "unknown agent" }]);
  });
});

describe("CommandBot", () => {
  it("executes /kill from the owner and ignores strangers", async () => {
    const sent: { chat_id: string; text: string }[] = [];
    const tgFetch = vi.fn<FetchLike>((_url, init) => {
      sent.push(JSON.parse(String(init.body)) as { chat_id: string; text: string });
      return Promise.resolve(okJson({ message_id: 1 }));
    });
    const agentFetch = vi.fn<FetchLike>(() => Promise.resolve(new Response(null, { status: 202 })));
    const bot = new CommandBot({
      client: new TelegramClient({ botToken: TOKEN, fetch: tgFetch }),
      ownerIds: ["42"],
      dispatcher: new KillDispatcher({ endpoints: parseAgentEndpoints("strata-test-1=http://a:9464"), token: "k".repeat(32), fetch: agentFetch }),
      logger: silent(),
    });
    await bot.handleMessage({ message_id: 1, date: 0, chat: { id: 7, type: "private" }, from: { id: 7, is_bot: false }, text: "/kill all" });
    expect(agentFetch).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);

    await bot.handleMessage({ message_id: 2, date: 0, chat: { id: 42, type: "private" }, from: { id: 42, is_bot: false }, text: "/kill all" });
    expect(agentFetch).toHaveBeenCalledOnce();
    expect(sent[0]!.chat_id).toBe("42");
    expect(sent[0]!.text).toContain("OK   strata-test-1: HTTP 202");
  });
});
