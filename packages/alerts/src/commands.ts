import type { TelegramMessage } from "./telegram.js";

/**
 * Owner commands accepted by the bot. There is deliberately no resume command: restarting
 * a killed agent needs someone at the host (docs/RUNBOOK.md, kill switch).
 */
export type BotCommand =
  | { readonly kind: "kill"; readonly target: "all" | string; readonly closePositions: boolean }
  | { readonly kind: "status" }
  | { readonly kind: "help" };

export type ParseResult =
  | { readonly ok: true; readonly command: BotCommand }
  | { readonly ok: false; readonly error: string };

const AGENT_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

export const HELP_TEXT = [
  "STRATA owner commands:",
  "/kill <agent|all>  cancel all orders and halt",
  "/kill <agent|all> close  also close positions with reduce-only IOC orders",
  "/status  list agents the bot can reach",
  "Resume needs the host: see docs/RUNBOOK.md.",
].join("\n");

export function parseCommand(text: string): ParseResult | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;
  const [rawCmd = "", ...args] = trimmed.split(/\s+/);
  // Telegram appends @BotName to commands in group chats.
  const cmd = rawCmd.split("@")[0]!.toLowerCase();

  switch (cmd) {
    case "/kill": {
      const target = args[0]?.toLowerCase();
      if (target === undefined) return { ok: false, error: "usage: /kill <agent|all> [close]" };
      if (target !== "all" && !AGENT_NAME.test(target)) return { ok: false, error: `not an agent name: ${target}` };
      const rest = args.slice(1).map((a) => a.toLowerCase());
      if (rest.length > 1 || (rest.length === 1 && rest[0] !== "close")) {
        return { ok: false, error: "usage: /kill <agent|all> [close]" };
      }
      return { ok: true, command: { kind: "kill", target, closePositions: rest[0] === "close" } };
    }
    case "/status":
      return { ok: true, command: { kind: "status" } };
    case "/help":
    case "/start":
      return { ok: true, command: { kind: "help" } };
    default:
      return { ok: false, error: `unknown command ${cmd}. Send /help.` };
  }
}

/**
 * Both the chat and the sender must be on the owner list. In a private chat they are the
 * same id; in a group this stops any other member from issuing /kill.
 */
export function isAuthorized(message: TelegramMessage, ownerIds: readonly string[]): boolean {
  if (message.from === undefined || message.from.is_bot) return false;
  return ownerIds.includes(String(message.chat.id)) && ownerIds.includes(String(message.from.id));
}
