/**
 * Keeps an Indexer gRPC-web stream alive: reconnects with capped exponential backoff on error or
 * end, and restarts when no message arrives within `stallMs` (gRPC-web streams can hang silently).
 */
import { errMsg, log } from "./log.js";

export interface StreamHandlers {
  onEnd: () => void;
  onError: (err: unknown) => void;
  onData: () => void;
}

export interface StreamHandle {
  stop: () => void;
  lastMessageAt: () => number | null;
}

export function resilientStream(
  name: string,
  start: (h: StreamHandlers, signal: AbortSignal) => void,
  opts: { stallMs?: number; maxBackoffMs?: number } = {},
): StreamHandle {
  const stallMs = opts.stallMs ?? 60_000;
  const maxBackoff = opts.maxBackoffMs ?? 60_000;
  let stopped = false;
  let attempt = 0;
  let generation = 0;
  let controller: AbortController | null = null;
  let lastMessage: number | null = null;
  let connectedAt = 0;
  let retryTimer: NodeJS.Timeout | null = null;

  const restart = (reason: string, err?: unknown) => {
    if (stopped) return;
    controller?.abort();
    controller = null;
    // A stall on a quiet market is not a failure: reconnect at once without growing the backoff,
    // otherwise idle streams end up disconnected for a minute at a time.
    const stalled = reason === "stalled";
    const delay = stalled ? 1000 : Math.min(maxBackoff, 1000 * 2 ** Math.min(attempt, 6));
    if (!stalled) attempt += 1;
    log("warn", "stream restart", { stream: name, reason, delayMs: delay, ...(err === undefined ? {} : { error: errMsg(err) }) });
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = setTimeout(connect, delay);
  };

  const connect = () => {
    if (stopped) return;
    const gen = ++generation;
    controller = new AbortController();
    connectedAt = Date.now();
    try {
      start(
        {
          onEnd: () => gen === generation && restart("ended"),
          onError: (e) => gen === generation && restart("error", e),
          onData: () => {
            if (gen !== generation) return;
            lastMessage = Date.now();
            attempt = 0;
          },
        },
        controller.signal,
      );
    } catch (e) {
      restart("start threw", e);
    }
  };

  const watchdog = setInterval(() => {
    const ref = Math.max(lastMessage ?? 0, connectedAt);
    if (!stopped && controller && Date.now() - ref > stallMs) restart("stalled");
  }, Math.min(stallMs, 15_000));
  watchdog.unref();

  connect();
  return {
    stop: () => {
      stopped = true;
      clearInterval(watchdog);
      if (retryTimer) clearTimeout(retryTimer);
      controller?.abort();
    },
    lastMessageAt: () => lastMessage,
  };
}
