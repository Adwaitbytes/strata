/**
 * Fan-out hub for /v1/stream (PRD 11.3). One poller per (network, channel) topic, shared by
 * every subscriber on this instance; per-subscriber pacing caps pushes at
 * WS_MAX_UPDATES_PER_SEC. State channels (book, agent, leaderboard) coalesce to the latest
 * value; the events channel queues discrete events with a bounded queue (oldest dropped).
 *
 * Backpressure: a client whose socket buffer is above `backpressureBytes` gets nothing new
 * until it drains; if it stays backed up for `backpressureGraceMs` it is closed with 1013.
 */
import {
  WS_MAX_UPDATES_PER_SEC,
  WsServerMessage,
  type BookSnapshot,
  type Fill,
  type GuardEvent,
  type LeaderboardRow,
  type NetworkName,
  type Quote,
  type TunerEvent,
} from "@strata/sdk";

export interface StreamSource {
  book(network: NetworkName, marketId: string): Promise<BookSnapshot | null>;
  agent(network: NetworkName, agentId: number): Promise<{ quotes: Quote[]; fills: Fill[] }>;
  leaderboard(network: NetworkName): Promise<LeaderboardRow[]>;
  /** Events with `at >= sinceMs`, any order. */
  eventsSince(network: NetworkName, sinceMs: number): Promise<Array<GuardEvent | TunerEvent>>;
}

export interface StreamClient {
  send(data: string): void;
  bufferedAmount(): number;
  close(code: number, reason: string): void;
}

export interface HubOptions {
  statePollMs: number;
  slowPollMs: number;
  minIntervalMs: number;
  eventQueueMax: number;
  backpressureBytes: number;
  backpressureGraceMs: number;
}

export const DEFAULT_HUB_OPTIONS: HubOptions = {
  statePollMs: 250,
  slowPollMs: 1_000,
  minIntervalMs: Math.ceil(1_000 / WS_MAX_UPDATES_PER_SEC),
  eventQueueMax: 100,
  backpressureBytes: 1_000_000,
  backpressureGraceMs: 10_000,
};

export interface HubLogger {
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

const silentLogger: HubLogger = { warn: () => {}, error: () => {} };

/** WebSocket close code 1013: try again later. */
export const CLOSE_TRY_AGAIN = 1013;

interface Subscription {
  client: StreamClient;
  pendingState: string | null;
  queue: string[];
  lastSentAt: number;
  timer: NodeJS.Timeout | null;
  backedUpSince: number | null;
}

interface Topic {
  network: NetworkName;
  channel: string;
  subs: Map<StreamClient, Subscription>;
  interval: NodeJS.Timeout;
  inFlight: boolean;
  lastState: string | null;
  eventCursor: number;
  seenAtCursor: Set<string>;
}

type ChannelKind =
  | { kind: "book"; marketId: string }
  | { kind: "agent"; agentId: number }
  | { kind: "leaderboard" }
  | { kind: "events" };

function parseChannel(channel: string): ChannelKind {
  if (channel === "leaderboard") return { kind: "leaderboard" };
  if (channel === "events") return { kind: "events" };
  if (channel.startsWith("book:")) return { kind: "book", marketId: channel.slice(5) };
  if (channel.startsWith("agent:")) return { kind: "agent", agentId: Number(channel.slice(6)) };
  throw new Error(`unknown channel ${channel}`);
}

const topicKey = (network: NetworkName, channel: string) => `${network}|${channel}`;

export class StreamHub {
  private readonly topics = new Map<string, Topic>();
  private readonly opts: HubOptions;

  constructor(
    private readonly source: StreamSource,
    opts: Partial<HubOptions> = {},
    private readonly log: HubLogger = silentLogger,
  ) {
    this.opts = { ...DEFAULT_HUB_OPTIONS, ...opts };
  }

  stats(): { topics: number; subscriptions: number } {
    let subscriptions = 0;
    for (const t of this.topics.values()) subscriptions += t.subs.size;
    return { topics: this.topics.size, subscriptions };
  }

  subscribe(client: StreamClient, network: NetworkName, channel: string): void {
    const key = topicKey(network, channel);
    let topic = this.topics.get(key);
    if (!topic) {
      const kind = parseChannel(channel);
      const pollMs = kind.kind === "book" || kind.kind === "agent" ? this.opts.statePollMs : this.opts.slowPollMs;
      const created: Topic = {
        network,
        channel,
        subs: new Map(),
        interval: setInterval(() => void this.poll(created), pollMs),
        inFlight: false,
        lastState: null,
        eventCursor: Date.now(),
        seenAtCursor: new Set(),
      };
      created.interval.unref?.();
      this.topics.set(key, created);
      topic = created;
      void this.poll(created);
    }
    if (topic.subs.has(client)) return;
    const sub: Subscription = { client, pendingState: null, queue: [], lastSentAt: 0, timer: null, backedUpSince: null };
    topic.subs.set(client, sub);
    if (topic.lastState !== null) this.offerState(sub, topic.lastState);
  }

  unsubscribe(client: StreamClient, network: NetworkName, channel: string): void {
    const key = topicKey(network, channel);
    const topic = this.topics.get(key);
    const sub = topic?.subs.get(client);
    if (!topic || !sub) return;
    if (sub.timer) clearTimeout(sub.timer);
    topic.subs.delete(client);
    if (topic.subs.size === 0) {
      clearInterval(topic.interval);
      this.topics.delete(key);
    }
  }

  remove(client: StreamClient): void {
    for (const t of [...this.topics.values()]) this.unsubscribe(client, t.network, t.channel);
  }

  close(): void {
    for (const t of this.topics.values()) {
      clearInterval(t.interval);
      for (const s of t.subs.values()) if (s.timer) clearTimeout(s.timer);
    }
    this.topics.clear();
  }

  private async poll(topic: Topic): Promise<void> {
    if (topic.inFlight) return;
    topic.inFlight = true;
    try {
      const kind = parseChannel(topic.channel);
      if (kind.kind === "events") {
        await this.pollEvents(topic);
        return;
      }
      const message = await this.stateMessage(topic, kind);
      if (message === null) return;
      const serialized = this.serialize(message);
      if (serialized === null || serialized === topic.lastState) return;
      topic.lastState = serialized;
      for (const sub of topic.subs.values()) this.offerState(sub, serialized);
    } catch (err) {
      this.log.warn({ err, channel: topic.channel, network: topic.network }, "stream poll failed");
    } finally {
      topic.inFlight = false;
    }
  }

  private async stateMessage(topic: Topic, kind: Exclude<ChannelKind, { kind: "events" }>): Promise<WsServerMessage | null> {
    switch (kind.kind) {
      case "book": {
        const data = await this.source.book(topic.network, kind.marketId);
        return data ? { type: "book", channel: topic.channel, data } : null;
      }
      case "agent":
        return { type: "agent", channel: topic.channel, data: await this.source.agent(topic.network, kind.agentId) };
      case "leaderboard":
        return { type: "leaderboard", channel: "leaderboard", data: await this.source.leaderboard(topic.network) };
    }
  }

  private async pollEvents(topic: Topic): Promise<void> {
    const events = await this.source.eventsSince(topic.network, topic.eventCursor);
    const fresh = events.filter((e) => e.at > topic.eventCursor || !topic.seenAtCursor.has(e.id)).sort((a, b) => a.at - b.at);
    for (const e of fresh) {
      if (e.at > topic.eventCursor) {
        topic.eventCursor = e.at;
        topic.seenAtCursor = new Set();
      }
      topic.seenAtCursor.add(e.id);
      const serialized = this.serialize({ type: "event", channel: "events", data: e });
      if (serialized === null) continue;
      for (const sub of topic.subs.values()) this.offerEvent(sub, serialized);
    }
  }

  /** Every outgoing message is checked against the sdk contract once, before fan-out. */
  private serialize(message: WsServerMessage): string | null {
    const r = WsServerMessage.safeParse(message);
    if (!r.success) {
      this.log.error({ issues: r.error.issues.slice(0, 3) }, "dropping stream message that violates WsServerMessage");
      return null;
    }
    return JSON.stringify(r.data);
  }

  private offerState(sub: Subscription, serialized: string): void {
    sub.pendingState = serialized;
    this.flush(sub);
  }

  private offerEvent(sub: Subscription, serialized: string): void {
    sub.queue.push(serialized);
    if (sub.queue.length > this.opts.eventQueueMax) sub.queue.splice(0, sub.queue.length - this.opts.eventQueueMax);
    this.flush(sub);
  }

  private schedule(sub: Subscription, delayMs: number): void {
    if (sub.timer) return;
    sub.timer = setTimeout(() => {
      sub.timer = null;
      this.flush(sub);
    }, delayMs);
    sub.timer.unref?.();
  }

  private flush(sub: Subscription): void {
    if (sub.pendingState === null && sub.queue.length === 0) return;
    const now = Date.now();
    if (sub.client.bufferedAmount() > this.opts.backpressureBytes) {
      sub.backedUpSince ??= now;
      if (now - sub.backedUpSince >= this.opts.backpressureGraceMs) {
        this.remove(sub.client);
        sub.client.close(CLOSE_TRY_AGAIN, "client too slow");
        return;
      }
      this.schedule(sub, Math.min(this.opts.minIntervalMs, this.opts.backpressureGraceMs - (now - sub.backedUpSince)));
      return;
    }
    sub.backedUpSince = null;
    const wait = sub.lastSentAt + this.opts.minIntervalMs - now;
    if (wait > 0) {
      this.schedule(sub, wait);
      return;
    }
    let next: string | undefined;
    if (sub.pendingState !== null) {
      next = sub.pendingState;
      sub.pendingState = null;
    } else {
      next = sub.queue.shift();
    }
    if (next === undefined) return;
    sub.client.send(next);
    sub.lastSentAt = now;
    if (sub.pendingState !== null || sub.queue.length > 0) this.schedule(sub, this.opts.minIntervalMs);
  }
}
