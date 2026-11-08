/**
 * Telegram owner bot: one long-poll consumer that turns `/kill` into authenticated calls
 * to each agent's private `/internal/kill` endpoint. Runs as the `telegram-bot` compose
 * service. Env:
 *   STRATA_AGENT_ENDPOINTS  name=url pairs, comma separated (required)
 *   TELEGRAM_BOT_TOKEN_FILE, TELEGRAM_CHAT_IDS_FILE, INTERNAL_KILL_TOKEN_FILE (secrets)
 *   METRICS_PORT            healthcheck port, default 9464
 */
import { createServer } from "node:http";
import { CommandBot } from "../bot.js";
import { loadTelegramConfig } from "../config.js";
import { KillDispatcher, loadKillToken, parseAgentEndpoints } from "../internal-kill.js";
import { DEFAULT_METRICS_PORT } from "../metrics.js";
import { TelegramClient } from "../telegram.js";

type Level = "info" | "warn" | "error";
const write = (level: Level, obj: Record<string, unknown>, msg: string): void => {
  process.stdout.write(`${JSON.stringify({ level, time: new Date().toISOString(), service: "telegram-bot", msg, ...obj })}\n`);
};
const logger = {
  info: (obj: Record<string, unknown>, msg: string) => write("info", obj, msg),
  warn: (obj: Record<string, unknown>, msg: string) => write("warn", obj, msg),
  error: (obj: Record<string, unknown>, msg: string) => write("error", obj, msg),
};

const POLL_STALE_MS = 120_000;

async function main(): Promise<void> {
  const port = Number(process.env.METRICS_PORT ?? DEFAULT_METRICS_PORT);
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) throw new Error(`invalid METRICS_PORT: ${process.env.METRICS_PORT}`);

  const cfg = loadTelegramConfig();
  const shutdown = new AbortController();
  let bot: CommandBot | null = null;

  const server = createServer((req, res) => {
    if (req.method !== "GET" || req.url !== "/healthz") {
      res.writeHead(404).end();
      return;
    }
    // Not configured yet is healthy (D30: the owner creates the bot later); a stalled poll is not.
    const last = bot?.lastPollOkAt ?? null;
    const healthy = bot === null || (last !== null && Date.now() - last < POLL_STALE_MS);
    res.writeHead(healthy ? 200 : 503, { "content-type": "application/json" });
    res.end(JSON.stringify({ telegram: bot === null ? "not_configured" : "configured", lastPollOkAt: last }));
  });
  server.listen(port, "0.0.0.0");

  const stop = (): void => {
    shutdown.abort();
    server.close();
  };
  process.once("SIGTERM", stop);
  process.once("SIGINT", stop);

  if (!cfg.ok) {
    if (cfg.reason === "invalid") throw new Error(`telegram config invalid: ${cfg.message}`);
    logger.warn({}, "telegram not configured; bot idle. Follow docs/RUNBOOK.md, Telegram setup, then restart this service.");
    return;
  }

  const endpointsRaw = process.env.STRATA_AGENT_ENDPOINTS;
  if (endpointsRaw === undefined || endpointsRaw.trim() === "") throw new Error("STRATA_AGENT_ENDPOINTS is required");
  const dispatcher = new KillDispatcher({ endpoints: parseAgentEndpoints(endpointsRaw), token: loadKillToken() });
  const client = new TelegramClient({ botToken: cfg.config.botToken });
  bot = new CommandBot({ client, ownerIds: cfg.config.chatIds, dispatcher, logger });

  logger.info({ agents: dispatcher.agents, owners: cfg.config.chatIds.length }, "telegram bot started");
  await bot.run(shutdown.signal);
  logger.info({}, "telegram bot stopped");
}

main().catch((err: unknown) => {
  logger.error({ err: err instanceof Error ? err.message : String(err) }, "telegram bot crashed");
  process.exit(1);
});
