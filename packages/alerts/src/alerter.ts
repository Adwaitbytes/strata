import { alertKey, formatAlert, type Alert } from "./alerts.js";
import { loadTelegramConfig, type TelegramConfig } from "./config.js";
import { TelegramApiError, TelegramClient, type FetchLike } from "./telegram.js";

/** pino compatible subset, so services can pass their logger straight in. */
export interface AlertLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export type NotifyResult =
  | { readonly status: "sent"; readonly chats: number }
  | { readonly status: "throttled" }
  | { readonly status: "logged_only" }
  | { readonly status: "failed"; readonly error: string };

export interface Alerter {
  /**
   * Never throws: an alerting outage must not crash a trading loop. Failures are logged
   * at error level and returned, so callers can count them in metrics.
   */
  notify(alert: Alert): Promise<NotifyResult>;
}

export interface TelegramAlerterOptions {
  readonly config: TelegramConfig;
  readonly logger: AlertLogger;
  /** Repeat suppression window per alert key. Default 10 minutes. */
  readonly cooldownMs?: number;
  readonly maxAttempts?: number;
  readonly fetch?: FetchLike;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const MAX_BACKOFF_MS = 30_000;

export class TelegramAlerter implements Alerter {
  readonly #client: TelegramClient;
  readonly #chatIds: readonly string[];
  readonly #logger: AlertLogger;
  readonly #cooldownMs: number;
  readonly #maxAttempts: number;
  readonly #now: () => number;
  readonly #sleep: (ms: number) => Promise<void>;
  readonly #lastSent = new Map<string, number>();

  constructor(opts: TelegramAlerterOptions) {
    this.#client = new TelegramClient(
      opts.fetch === undefined ? { botToken: opts.config.botToken } : { botToken: opts.config.botToken, fetch: opts.fetch },
    );
    this.#chatIds = opts.config.chatIds;
    this.#logger = opts.logger;
    this.#cooldownMs = opts.cooldownMs ?? 10 * 60_000;
    this.#maxAttempts = Math.max(1, opts.maxAttempts ?? 3);
    this.#now = opts.now ?? Date.now;
    this.#sleep = opts.sleep ?? defaultSleep;
  }

  async notify(alert: Alert): Promise<NotifyResult> {
    const key = alertKey(alert);
    const now = this.#now();
    const last = this.#lastSent.get(key);
    if (last !== undefined && now - last < this.#cooldownMs) return { status: "throttled" };
    // Reserve the slot before awaiting so concurrent callers in one cycle do not double send.
    this.#lastSent.set(key, now);

    const text = formatAlert(alert, new Date(now));
    let delivered = 0;
    let lastError: string | null = null;
    for (const chatId of this.#chatIds) {
      const err = await this.#sendWithRetry(chatId, text);
      if (err === null) delivered++;
      else lastError = err;
    }
    if (delivered === 0) {
      // Allow the next occurrence to retry instead of being throttled behind a failure.
      if (last === undefined) this.#lastSent.delete(key);
      else this.#lastSent.set(key, last);
      const error = lastError ?? "no chats configured";
      this.#logger.error({ alert: alert.kind, key, error }, "telegram alert delivery failed");
      return { status: "failed", error };
    }
    if (lastError !== null) this.#logger.warn({ alert: alert.kind, key, error: lastError }, "telegram alert reached only some chats");
    return { status: "sent", chats: delivered };
  }

  async #sendWithRetry(chatId: string, text: string): Promise<string | null> {
    for (let attempt = 1; ; attempt++) {
      try {
        await this.#client.sendMessage(chatId, text);
        return null;
      } catch (err) {
        const apiErr = err instanceof TelegramApiError ? err : null;
        const message = err instanceof Error ? err.message : String(err);
        if (apiErr === null || !apiErr.retryable || attempt >= this.#maxAttempts) return message;
        const backoff = apiErr.retryAfterSec !== null ? apiErr.retryAfterSec * 1000 : 500 * 2 ** (attempt - 1);
        await this.#sleep(Math.min(backoff, MAX_BACKOFF_MS));
      }
    }
  }
}

/** Used until the owner creates the bot (D30): alerts still reach the structured logs. */
export class LogOnlyAlerter implements Alerter {
  constructor(private readonly logger: AlertLogger) {}

  notify(alert: Alert): Promise<NotifyResult> {
    this.logger.warn({ alert, telegram: "not_configured" }, formatAlert(alert, new Date()));
    return Promise.resolve({ status: "logged_only" });
  }
}

/**
 * Build the alerter for a service at startup. A malformed token or chat id throws, so a
 * typo fails the container healthcheck instead of silently dropping every alert.
 */
export function createAlerter(logger: AlertLogger, env: Readonly<Record<string, string | undefined>> = process.env): Alerter {
  const cfg = loadTelegramConfig(env);
  if (cfg.ok) return new TelegramAlerter({ config: cfg.config, logger });
  if (cfg.reason === "not_configured") {
    logger.warn({}, "telegram is not configured; alerts go to logs only (see docs/RUNBOOK.md, Telegram setup)");
    return new LogOnlyAlerter(logger);
  }
  throw new Error(`telegram config invalid: ${cfg.message}`);
}
