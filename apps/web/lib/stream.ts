/**
 * WebSocket client for `ws /v1/stream` (PRD 11.3). One socket per network, shared by every
 * subscriber on the page. Reconnects with capped exponential backoff and full jitter,
 * resubscribes all live channels after reconnect, and validates every frame with the sdk schema.
 */
import { WsServerMessage, type NetworkName, type WsChannel, type WsClientMessage } from "@strata/sdk";

export type StreamState = "idle" | "connecting" | "open" | "reconnecting" | "closed";

export interface BackoffOptions {
  baseMs: number;
  maxMs: number;
}

/** Full-jitter backoff: random in [0, min(max, base * 2^attempt)]. `random` is injectable for tests. */
export function backoffDelay(attempt: number, { baseMs, maxMs }: BackoffOptions, random: () => number = Math.random): number {
  const ceiling = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt));
  return Math.round(ceiling * random());
}

type Listener = (msg: WsServerMessage) => void;
type StateListener = (s: StreamState) => void;

interface SocketLike {
  readyState: number;
  send(data: string): void;
  close(): void;
  onopen: ((ev: Event) => void) | null;
  onclose: ((ev: CloseEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
}

export interface StreamDeps {
  createSocket: (url: string) => SocketLike;
  setTimer: (fn: () => void, ms: number) => unknown;
  clearTimer: (handle: unknown) => void;
  random?: () => number;
}

const OPEN = 1;
const PING_MS = 20_000;

export class StreamClient {
  private socket: SocketLike | null = null;
  private attempt = 0;
  private reconnectTimer: unknown = null;
  private pingTimer: unknown = null;
  private readonly channels = new Map<WsChannel, Set<Listener>>();
  private readonly stateListeners = new Set<StateListener>();
  private state: StreamState = "idle";
  private stopped = false;

  constructor(
    private readonly url: string,
    private readonly network: NetworkName,
    private readonly deps: StreamDeps,
    private readonly backoff: BackoffOptions = { baseMs: 500, maxMs: 15_000 },
  ) {}

  getState(): StreamState {
    return this.state;
  }

  onState(fn: StateListener): () => void {
    this.stateListeners.add(fn);
    fn(this.state);
    return () => this.stateListeners.delete(fn);
  }

  subscribe(channel: WsChannel, fn: Listener): () => void {
    let set = this.channels.get(channel);
    const isNew = !set;
    if (!set) {
      set = new Set();
      this.channels.set(channel, set);
    }
    set.add(fn);
    if (this.state === "idle" || this.state === "closed") {
      this.stopped = false;
      this.connect();
    } else if (isNew) {
      this.send({ op: "subscribe", network: this.network, channels: [channel] });
    }
    return () => {
      const s = this.channels.get(channel);
      if (!s) return;
      s.delete(fn);
      if (s.size === 0) {
        this.channels.delete(channel);
        this.send({ op: "unsubscribe", network: this.network, channels: [channel] });
      }
      if (this.channels.size === 0) this.stop();
    };
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) this.deps.clearTimer(this.reconnectTimer);
    if (this.pingTimer) this.deps.clearTimer(this.pingTimer);
    this.reconnectTimer = null;
    this.pingTimer = null;
    const s = this.socket;
    this.socket = null;
    if (s) {
      s.onclose = null;
      s.close();
    }
    this.setState("closed");
  }

  private setState(s: StreamState) {
    this.state = s;
    for (const fn of this.stateListeners) fn(s);
  }

  private send(msg: WsClientMessage) {
    if (this.socket && this.socket.readyState === OPEN) this.socket.send(JSON.stringify(msg));
  }

  private connect() {
    this.setState(this.attempt === 0 ? "connecting" : "reconnecting");
    let socket: SocketLike;
    try {
      socket = this.deps.createSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.onopen = () => {
      this.attempt = 0;
      this.setState("open");
      const channels = [...this.channels.keys()];
      // The server accepts at most 20 channels per message.
      for (let i = 0; i < channels.length; i += 20) {
        this.send({ op: "subscribe", network: this.network, channels: channels.slice(i, i + 20) });
      }
      this.schedulePing();
    };
    socket.onmessage = (ev) => {
      if (typeof ev.data !== "string") return;
      let raw: unknown;
      try {
        raw = JSON.parse(ev.data);
      } catch {
        return;
      }
      const parsed = WsServerMessage.safeParse(raw);
      if (!parsed.success) return;
      const msg = parsed.data;
      if (!("channel" in msg)) return;
      const listeners = this.channels.get(msg.channel as WsChannel);
      if (listeners) for (const fn of listeners) fn(msg);
    };
    socket.onerror = () => {
      // onclose follows and owns the reconnect.
    };
    socket.onclose = () => {
      this.socket = null;
      if (this.pingTimer) this.deps.clearTimer(this.pingTimer);
      if (!this.stopped && this.channels.size > 0) this.scheduleReconnect();
      else this.setState("closed");
    };
  }

  private schedulePing() {
    this.pingTimer = this.deps.setTimer(() => {
      this.send({ op: "ping" });
      if (this.socket) this.schedulePing();
    }, PING_MS);
  }

  private scheduleReconnect() {
    this.setState("reconnecting");
    const delay = backoffDelay(this.attempt, this.backoff, this.deps.random);
    this.attempt += 1;
    this.reconnectTimer = this.deps.setTimer(() => {
      this.reconnectTimer = null;
      if (!this.stopped) this.connect();
    }, delay);
  }
}
