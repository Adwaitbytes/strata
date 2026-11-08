import { readFileSync } from "node:fs";
import { z } from "zod";

/**
 * Telegram credentials are read from files mounted by docker compose secrets
 * (`/run/secrets/*`, sourced from `.secrets/`), so the token never sits in the
 * container environment where `docker inspect` would show it. Plain env vars are a
 * fallback for local runs only (see `.env.example`).
 */
export const DEFAULT_TOKEN_FILE = "/run/secrets/telegram_bot_token";
export const DEFAULT_CHAT_IDS_FILE = "/run/secrets/telegram_chat_ids";

const BotToken = z.string().regex(/^\d+:[A-Za-z0-9_-]{30,}$/, "not a Telegram bot token (expected <id>:<secret>)");
/** Private chats are positive ids, groups and channels are negative. */
const ChatId = z.string().regex(/^-?\d{1,20}$/, "chat id must be an integer");

export interface TelegramConfig {
  readonly botToken: string;
  /** Owner chat ids: alerts go to all of them, commands are accepted only from them. */
  readonly chatIds: readonly string[];
}

export type ConfigResult =
  | { readonly ok: true; readonly config: TelegramConfig }
  | { readonly ok: false; readonly reason: "not_configured" }
  | { readonly ok: false; readonly reason: "invalid"; readonly message: string };

type Env = Readonly<Record<string, string | undefined>>;
type ReadFile = (path: string) => string | null;

const readFileOrNull: ReadFile = (path) => {
  try {
    // An empty placeholder file (created by infra/scripts/init-secrets.sh) means "not set".
    const text = readFileSync(path, "utf8");
    return text.trim() === "" ? null : text;
  } catch (err) {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") return null;
    throw err;
  }
};

/** Comma, space or newline separated list. */
export function parseChatIds(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Resolve Telegram config. Missing everything is a legitimate state (the owner has not
 * created the bot yet, D30) and returns `not_configured`; a present but malformed value
 * returns `invalid` so a typo never silently disables alerts.
 */
export function loadTelegramConfig(env: Env = process.env, readFile: ReadFile = readFileOrNull): ConfigResult {
  const tokenRaw =
    readFile(env.TELEGRAM_BOT_TOKEN_FILE ?? DEFAULT_TOKEN_FILE) ?? (env.TELEGRAM_BOT_TOKEN?.length ? env.TELEGRAM_BOT_TOKEN : null);
  const chatRaw =
    readFile(env.TELEGRAM_CHAT_IDS_FILE ?? DEFAULT_CHAT_IDS_FILE) ??
    (env.TELEGRAM_OWNER_CHAT_IDS?.length ? env.TELEGRAM_OWNER_CHAT_IDS : null);

  if (tokenRaw === null && chatRaw === null) return { ok: false, reason: "not_configured" };
  if (tokenRaw === null) return { ok: false, reason: "invalid", message: "chat ids are set but the bot token is missing" };
  if (chatRaw === null) return { ok: false, reason: "invalid", message: "bot token is set but no owner chat ids are configured" };

  const token = BotToken.safeParse(tokenRaw.trim());
  // Never echo the token value in the error.
  if (!token.success) return { ok: false, reason: "invalid", message: "bot token has an unexpected format" };

  const ids = parseChatIds(chatRaw);
  if (ids.length === 0) return { ok: false, reason: "invalid", message: "owner chat id list is empty" };
  for (const id of ids) {
    if (!ChatId.safeParse(id).success) return { ok: false, reason: "invalid", message: `invalid chat id: ${id}` };
  }
  return { ok: true, config: { botToken: token.data, chatIds: [...new Set(ids)] } };
}
