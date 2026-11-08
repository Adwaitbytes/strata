import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WsServerMessage, type BookSnapshot, type GuardEvent, type NetworkName, type TunerEvent } from "@strata/sdk";
import { StreamHub, type StreamClient, type StreamSource } from "../src/stream/hub.js";
import { MARKET_A, book, guardEvent } from "./support/fixtures.js";

const BOOK = `book:${MARKET_A}`;

class FakeClient implements StreamClient {
  sent: WsServerMessage[] = [];
  buffered = 0;
  closed: { code: number; reason: string } | null = null;
  send(data: string) { this.sent.push(WsServerMessage.parse(JSON.parse(data))); }
  bufferedAmount() { return this.buffered; }
  close(code: number, reason: string) { this.closed = { code, reason }; }
}

class FakeSource implements StreamSource {
  calls = 0;
  current: BookSnapshot | null = book(MARKET_A, 5_000);
  events: Array<GuardEvent | TunerEvent> = [];
  async book(_n: NetworkName, _m: string) { this.calls++; return this.current; }
  async agent() { this.calls++; return { quotes: [], fills: [] }; }
  async leaderboard() { this.calls++; return []; }
  async eventsSince(_n: NetworkName, sinceMs: number) { this.calls++; return this.events.filter((e) => e.at >= sinceMs); }
}

let source: FakeSource;
let hub: StreamHub;

beforeEach(() => {
  vi.useFakeTimers({ now: 1_000_000 });
  source = new FakeSource();
  hub = new StreamHub(source, { statePollMs: 50, slowPollMs: 50, minIntervalMs: 250, eventQueueMax: 3, backpressureBytes: 1_000, backpressureGraceMs: 2_000 });
});
afterEach(() => {
  hub.close();
  vi.useRealTimers();
});

describe("StreamHub", () => {
  it("pushes the current book once and stays quiet while it is unchanged", async () => {
    const c = new FakeClient();
    hub.subscribe(c, "testnet", BOOK);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(c.sent).toHaveLength(1);
    expect(c.sent[0]).toMatchObject({ type: "book", channel: BOOK });
  });

  it("throttles a fast-changing channel to 4 updates per second and ends on the latest state", async () => {
    const c = new FakeClient();
    hub.subscribe(c, "testnet", BOOK);
    for (let i = 0; i < 40; i++) {
      source.current = book(MARKET_A, 10_000 + i);
      await vi.advanceTimersByTimeAsync(50);
    }
    // 2 seconds of changes every 50ms
    expect(c.sent.length).toBeLessThanOrEqual(9);
    await vi.advanceTimersByTimeAsync(500);
    const last = c.sent.at(-1);
    expect(last?.type === "book" && last.data.at).toBe(10_039);
  });

  it("shares one poller across clients on the same topic", async () => {
    const a = new FakeClient();
    const b = new FakeClient();
    hub.subscribe(a, "testnet", BOOK);
    hub.subscribe(b, "testnet", BOOK);
    await vi.advanceTimersByTimeAsync(500);
    expect(source.calls).toBeLessThanOrEqual(11);
    expect(a.sent).toHaveLength(1);
    expect(b.sent).toHaveLength(1);
  });

  it("stops polling once the last subscriber leaves", async () => {
    const c = new FakeClient();
    hub.subscribe(c, "testnet", BOOK);
    await vi.advanceTimersByTimeAsync(200);
    hub.remove(c);
    const calls = source.calls;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(source.calls).toBe(calls);
    expect(hub.stats().topics).toBe(0);
  });

  it("delivers new events in order, paced, and drops the oldest past the queue cap", async () => {
    const c = new FakeClient();
    hub.subscribe(c, "testnet", "events");
    await vi.advanceTimersByTimeAsync(100);
    const t = Date.now();
    source.events = [1, 2, 3, 4, 5].map((i) => guardEvent(t + i, `g${i}`));
    await vi.advanceTimersByTimeAsync(2_000);
    const ids = c.sent.map((m) => (m.type === "event" ? m.data.id : ""));
    // g1 goes out at once; g2..g5 queue behind it and the cap of 3 drops g2.
    expect(ids).toEqual(["g1", "g3", "g4", "g5"]);
  });

  it("does not resend an event already delivered", async () => {
    const c = new FakeClient();
    hub.subscribe(c, "testnet", "events");
    await vi.advanceTimersByTimeAsync(100);
    source.events = [guardEvent(Date.now() + 1, "once")];
    await vi.advanceTimersByTimeAsync(2_000);
    expect(c.sent).toHaveLength(1);
  });

  it("holds messages while the socket is backed up and disconnects a client that never drains", async () => {
    const c = new FakeClient();
    c.buffered = 10_000;
    hub.subscribe(c, "testnet", BOOK);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(c.sent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(c.closed?.code).toBe(1013);
  });

  it("delivers held state once the socket drains", async () => {
    const c = new FakeClient();
    c.buffered = 10_000;
    hub.subscribe(c, "testnet", BOOK);
    await vi.advanceTimersByTimeAsync(500);
    c.buffered = 0;
    await vi.advanceTimersByTimeAsync(500);
    expect(c.sent).toHaveLength(1);
    expect(c.closed).toBeNull();
  });

  it("keeps serving after a source failure", async () => {
    const c = new FakeClient();
    const original = source.book.bind(source);
    let fail = true;
    source.book = async (n, m) => { if (fail) throw new Error("db down"); return original(n, m); };
    hub.subscribe(c, "testnet", BOOK);
    await vi.advanceTimersByTimeAsync(200);
    fail = false;
    await vi.advanceTimersByTimeAsync(300);
    expect(c.sent).toHaveLength(1);
  });
});
