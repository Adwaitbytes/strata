import { mockLeaderboard } from "@strata/sdk";
import { describe, expect, it } from "vitest";
import { StreamClient, backoffDelay } from "./stream";

class FakeSocket {
  readyState = 0;
  sent: string[] = [];
  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.readyState = 3;
    this.onclose?.(new Event("close") as CloseEvent);
  }
  open() {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }
  drop() {
    this.readyState = 3;
    this.onclose?.(new Event("close") as CloseEvent);
  }
}

function harness() {
  const sockets: FakeSocket[] = [];
  const timers: { fn: () => void; ms: number }[] = [];
  const client = new StreamClient("wss://x/v1/stream", "testnet", {
    createSocket: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    setTimer: (fn, ms) => {
      const t = { fn, ms };
      timers.push(t);
      return t;
    },
    clearTimer: (h) => {
      const i = timers.indexOf(h as (typeof timers)[number]);
      if (i >= 0) timers.splice(i, 1);
    },
    random: () => 1,
  });
  return { client, sockets, timers };
}

describe("backoffDelay", () => {
  it("grows exponentially and caps", () => {
    const o = { baseMs: 500, maxMs: 4000 };
    expect([0, 1, 2, 3, 4].map((a) => backoffDelay(a, o, () => 1))).toEqual([500, 1000, 2000, 4000, 4000]);
    expect(backoffDelay(3, o, () => 0)).toBe(0);
  });
});

describe("StreamClient", () => {
  it("subscribes on open and delivers validated frames", () => {
    const { client, sockets } = harness();
    const got: unknown[] = [];
    client.subscribe("leaderboard", (m) => got.push(m));
    sockets[0]!.open();
    expect(JSON.parse(sockets[0]!.sent[0]!)).toEqual({ op: "subscribe", network: "testnet", channels: ["leaderboard"] });
    sockets[0]!.onmessage?.(new MessageEvent("message", { data: JSON.stringify({ type: "leaderboard", channel: "leaderboard", data: mockLeaderboard("testnet", 2) }) }));
    sockets[0]!.onmessage?.(new MessageEvent("message", { data: JSON.stringify({ type: "leaderboard", channel: "leaderboard", data: "garbage" }) }));
    sockets[0]!.onmessage?.(new MessageEvent("message", { data: "{not json" }));
    expect(got).toHaveLength(1);
  });

  it("reconnects with backoff and resubscribes", () => {
    const { client, sockets, timers } = harness();
    const states: string[] = [];
    client.onState((s) => states.push(s));
    client.subscribe("events", () => undefined);
    sockets[0]!.open();
    sockets[0]!.drop();
    expect(client.getState()).toBe("reconnecting");
    const reconnect = timers.find((t) => t.ms === 500);
    expect(reconnect).toBeDefined();
    reconnect!.fn();
    sockets[1]!.open();
    expect(JSON.parse(sockets[1]!.sent[0]!).channels).toEqual(["events"]);
    expect(states).toContain("open");
  });

  it("closes when the last subscriber leaves", () => {
    const { client, sockets } = harness();
    const off = client.subscribe("events", () => undefined);
    sockets[0]!.open();
    off();
    expect(client.getState()).toBe("closed");
    expect(sockets).toHaveLength(1);
  });
});
