import { z } from "zod";

/** Telegram Bot API, https://core.telegram.org/bots/api */
const API_BASE = "https://api.telegram.org";

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

const ApiEnvelope = z.object({
  ok: z.boolean(),
  result: z.unknown().optional(),
  description: z.string().optional(),
  error_code: z.number().optional(),
  parameters: z.object({ retry_after: z.number().optional() }).optional(),
});

export const TelegramMessage = z.object({
  message_id: z.number(),
  date: z.number(),
  chat: z.object({ id: z.number(), type: z.string() }),
  from: z.object({ id: z.number(), is_bot: z.boolean() }).optional(),
  text: z.string().optional(),
});
export type TelegramMessage = z.infer<typeof TelegramMessage>;

export const TelegramUpdate = z.object({
  update_id: z.number(),
  message: TelegramMessage.optional(),
});
export type TelegramUpdate = z.infer<typeof TelegramUpdate>;

export class TelegramApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Seconds Telegram asked us to wait (HTTP 429), when given. */
    readonly retryAfterSec: number | null,
  ) {
    super(message);
    this.name = "TelegramApiError";
  }

  get retryable(): boolean {
    return this.status === 429 || this.status >= 500 || this.status === 0;
  }
}

export interface TelegramClientOptions {
  readonly botToken: string;
  readonly fetch?: FetchLike;
  readonly timeoutMs?: number;
}

export class TelegramClient {
  readonly #token: string;
  readonly #fetch: FetchLike;
  readonly #timeoutMs: number;

  constructor(opts: TelegramClientOptions) {
    this.#token = opts.botToken;
    this.#fetch = opts.fetch ?? ((input, init) => fetch(input, init));
    this.#timeoutMs = opts.timeoutMs ?? 10_000;
  }

  async sendMessage(chatId: string, text: string): Promise<void> {
    await this.#call("sendMessage", { chat_id: chatId, text, disable_web_page_preview: true }, this.#timeoutMs);
  }

  /** Long poll. `timeoutSec` is the server-side hold time. */
  async getUpdates(offset: number, timeoutSec: number): Promise<TelegramUpdate[]> {
    const result = await this.#call(
      "getUpdates",
      { offset, timeout: timeoutSec, allowed_updates: ["message"] },
      this.#timeoutMs + timeoutSec * 1000,
    );
    return z.array(TelegramUpdate).parse(result);
  }

  async #call(method: string, body: Record<string, unknown>, timeoutMs: number): Promise<unknown> {
    let res: Response;
    try {
      res = await this.#fetch(`${API_BASE}/bot${this.#token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      // Network errors from fetch can include the request URL, which contains the token.
      const name = err instanceof Error ? err.name : "unknown";
      throw new TelegramApiError(`telegram ${method} network error (${name})`, 0, null);
    }
    const json: unknown = await res.json().catch(() => null);
    const parsed = ApiEnvelope.safeParse(json);
    if (!parsed.success) throw new TelegramApiError(`telegram ${method} returned a non-JSON body`, res.status, null);
    if (!parsed.data.ok) {
      throw new TelegramApiError(
        `telegram ${method} failed: ${parsed.data.description ?? "unknown error"}`,
        parsed.data.error_code ?? res.status,
        parsed.data.parameters?.retry_after ?? null,
      );
    }
    return parsed.data.result;
  }
}
