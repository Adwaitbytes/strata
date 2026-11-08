/**
 * Resilient wrapper around sdk-ts Indexer gRPC-web streams (StreamSubscription).
 *
 * Each managed stream is (re)opened against the endpoint bundles in order. On error or completion
 * it reconnects with exponential backoff and full jitter, rotating to the next endpoint. A
 * watchdog also restarts a stream that has been silent longer than `idleRestartMs`, since a
 * half-open HTTP/2 stream can stop delivering without raising an error.
 */
import type { NetworkEndpoints } from "@injectivelabs/networks";
import type { EndpointSet } from "./endpoints.js";
import { backoffDelay } from "./retry.js";

export interface Subscription {
  unsubscribe(): void;
  on(event: "error", handler: (error: unknown) => void): void;
  on(event: "complete", handler: () => void): void;
}

export interface ManagedStreamOptions {
  name: string;
  /** Opens the stream on one endpoint bundle and wires its data callback. */
  open: (endpoints: NetworkEndpoints) => Subscription;
  /** Called after every (re)connect, e.g. to backfill missed fills or refresh a snapshot. */
  onReconnect?: () => void;
  idleRestartMs?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  log?: (event: StreamLogEvent) => void;
}

export interface StreamLogEvent {
  stream: string;
  kind: "open" | "error" | "complete" | "idle_restart" | "closed";
  endpoint: string;
  attempt: number;
  detail?: string;
}

export interface StreamHealth {
  name: string;
  connected: boolean;
  lastMessageAtMs: number | null;
  reconnects: number;
}

export class ManagedStream {
  private sub: Subscription | null = null;
  private attempt = 0;
  private endpointIndex = 0;
  private reconnects = 0;
  private lastMessageAt: number | null = null;
  private connected = false;
  private closed = false;
  private retryTimer: NodeJS.Timeout | null = null;
  private watchdog: NodeJS.Timeout | null = null;

  constructor(
    private readonly set: EndpointSet,
    private readonly opts: ManagedStreamOptions,
  ) {}

  start(): void {
    this.connect();
    const idle = this.opts.idleRestartMs ?? 60_000;
    this.watchdog = setInterval(() => {
      if (this.closed || !this.connected) return;
      const last = this.lastMessageAt ?? 0;
      if (Date.now() - last > idle) {
        this.log("idle_restart");
        this.restart();
      }
    }, Math.max(1_000, Math.floor(idle / 4)));
    this.watchdog.unref();
  }

  /** Data callbacks must call this so the watchdog sees traffic. */
  touch(): void {
    this.lastMessageAt = Date.now();
    this.attempt = 0;
  }

  health(): StreamHealth {
    return { name: this.opts.name, connected: this.connected, lastMessageAtMs: this.lastMessageAt, reconnects: this.reconnects };
  }

  close(): void {
    this.closed = true;
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    if (this.watchdog !== null) clearInterval(this.watchdog);
    this.teardown();
    this.log("closed");
  }

  private endpoint(): NetworkEndpoints {
    const e = this.set.bundles[this.endpointIndex % this.set.bundles.length];
    if (e === undefined) throw new Error("no endpoints");
    return e;
  }

  private log(kind: StreamLogEvent["kind"], detail?: string): void {
    this.opts.log?.({ stream: this.opts.name, kind, endpoint: this.endpoint().indexer, attempt: this.attempt, ...(detail === undefined ? {} : { detail }) });
  }

  private teardown(): void {
    const sub = this.sub;
    this.sub = null;
    this.connected = false;
    if (sub !== null) {
      try {
        sub.unsubscribe();
      } catch {
        // Already closed.
      }
    }
  }

  private connect(): void {
    if (this.closed) return;
    try {
      const sub = this.opts.open(this.endpoint());
      this.sub = sub;
      this.connected = true;
      this.lastMessageAt = Date.now();
      this.log("open");
      sub.on("error", (err: unknown) => {
        if (this.sub !== sub) return;
        this.log("error", err instanceof Error ? err.message : String(err));
        this.restart();
      });
      sub.on("complete", () => {
        if (this.sub !== sub) return;
        this.log("complete");
        this.restart();
      });
      if (this.reconnects > 0) this.opts.onReconnect?.();
    } catch (err) {
      this.log("error", err instanceof Error ? err.message : String(err));
      this.restart();
    }
  }

  private restart(): void {
    if (this.closed) return;
    this.teardown();
    this.reconnects += 1;
    this.endpointIndex += 1;
    const delay = backoffDelay(this.attempt, this.opts.baseBackoffMs ?? 500, this.opts.maxBackoffMs ?? 30_000);
    this.attempt += 1;
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
    this.retryTimer.unref();
  }
}
