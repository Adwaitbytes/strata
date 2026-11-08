import { describe, expect, it } from "vitest";
import { WindowStore } from "../src/rate-limit-store.js";

const incr = (s: WindowStore, key: string, windowMs: number) =>
  new Promise<{ current: number; ttl: number }>((resolve, reject) =>
    s.incr(key, (err, res) => (err || !res ? reject(err) : resolve(res)), windowMs));

describe("WindowStore", () => {
  it("counts hits inside one window", async () => {
    let t = 1_000;
    const s = new WindowStore({ now: () => t });
    expect((await incr(s, "a", 100)).current).toBe(1);
    t += 10;
    expect(await incr(s, "a", 100)).toEqual({ current: 2, ttl: 90 });
  });

  it("forgets every key once its window has passed", async () => {
    let t = 1_000;
    const s = new WindowStore({ now: () => t });
    await incr(s, "203.0.113.9", 100);
    t += 101;
    s.sweep();
    expect(s.size).toBe(0);
    expect((await incr(s, "203.0.113.9", 100)).current).toBe(1);
  });
});

describe("WindowStore children", () => {
  it("keeps route-level counters separate and sweeps them with the parent", async () => {
    let t = 0;
    const s = new WindowStore({ now: () => t });
    const c = s.child() as WindowStore;
    await incr(s, "k", 100);
    expect((await incr(c, "k", 100)).current).toBe(1);
    t = 200;
    s.sweep();
    expect(c.size).toBe(0);
  });
});
