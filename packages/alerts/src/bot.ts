import type { AlertLogger } from "./alerter.js";
import { HELP_TEXT, isAuthorized, parseCommand, type BotCommand } from "./commands.js";
import type { DispatchOutcome, KillDispatcher } from "./internal-kill.js";
import type { TelegramClient, TelegramMessage } from "./telegram.js";

export interface CommandBotOptions {
  readonly client: TelegramClient;
  readonly ownerIds: readonly string[];
  readonly dispatcher: KillDispatcher;
  readonly logger: AlertLogger & { info(obj: Record<string, unknown>, msg: string): void };
  readonly pollTimeoutSec?: number;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

const formatOutcomes = (title: string, outcomes: readonly DispatchOutcome[]): string =>
  [title, ...outcomes.map((o) => `${o.ok ? "OK  " : "FAIL"} ${o.agent}: ${o.detail}`)].join("\n");

/**
 * Single long-poll consumer of the bot's updates. Telegram allows one getUpdates consumer
 * per token, which is why /kill lives in its own container and fans out to agents over the
 * private network instead of every agent polling Telegram.
 */
export class CommandBot {
  readonly #o: CommandBotOptions;
  readonly #now: () => number;
  readonly #sleep: (ms: number) => Promise<void>;
  #offset = 0;
  #lastPollOkAt: number | null = null;

  constructor(opts: CommandBotOptions) {
    this.#o = opts;
    this.#now = opts.now ?? Date.now;
    this.#sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  get lastPollOkAt(): number | null {
    return this.#lastPollOkAt;
  }

  async run(signal: AbortSignal): Promise<void> {
    let failures = 0;
    while (!signal.aborted) {
      try {
        const updates = await this.#o.client.getUpdates(this.#offset, this.#o.pollTimeoutSec ?? 25);
        this.#lastPollOkAt = this.#now();
        failures = 0;
        for (const update of updates) {
          // Advance first: a message that crashes the handler must not be replayed forever.
          this.#offset = Math.max(this.#offset, update.update_id + 1);
          if (update.message !== undefined) await this.handleMessage(update.message);
        }
      } catch (err) {
        failures++;
        const backoff = Math.min(60_000, 1_000 * 2 ** Math.min(failures, 6));
        this.#o.logger.error({ err: err instanceof Error ? err.message : String(err), backoffMs: backoff }, "telegram poll failed");
        await this.#sleep(backoff);
      }
    }
  }

  async handleMessage(message: TelegramMessage): Promise<void> {
    if (message.text === undefined) return;
    if (!isAuthorized(message, this.#o.ownerIds)) {
      // No reply: answering strangers confirms the bot is live and worth probing.
      this.#o.logger.warn({ chatId: message.chat.id, fromId: message.from?.id ?? null }, "ignored message from non-owner chat");
      return;
    }
    const parsed = parseCommand(message.text);
    if (parsed === null) return;
    const reply = parsed.ok ? await this.#execute(parsed.command) : parsed.error;
    await this.#o.client.sendMessage(String(message.chat.id), reply);
  }

  async #execute(command: BotCommand): Promise<string> {
    switch (command.kind) {
      case "help":
        return HELP_TEXT;
      case "status":
        return formatOutcomes("Agent health:", await this.#o.dispatcher.status());
      case "kill": {
        this.#o.logger.warn({ target: command.target, closePositions: command.closePositions }, "kill command received from owner");
        const outcomes = await this.#o.dispatcher.kill(command.target, command.closePositions, this.#now());
        const failed = outcomes.filter((o) => !o.ok).length;
        if (failed > 0) this.#o.logger.error({ outcomes }, "kill did not reach every target");
        const title =
          failed === 0
            ? `Kill sent${command.closePositions ? " with close" : ""}. Agents cancel all orders and stay halted.`
            : `Kill reached ${outcomes.length - failed} of ${outcomes.length}. Use the env flag or signed API for the rest (RUNBOOK).`;
        return formatOutcomes(title, outcomes);
      }
    }
  }
}
