import { describe, expect, it } from "vitest";
import { backoffDelay, retryWithBackoff } from "./retry.js";

describe("backoffDelay", () => {
  it("doubles from the base and caps at the max", () => {
    expect([0, 1, 2, 3, 4].map((a) => backoffDelay(a, 100, 500))).toEqual([100, 200, 400, 500, 500]);
  });
});

describe("retryWithBackoff", () => {
  it("retries until the operation succeeds, sleeping with backoff between attempts", async () => {
    const slept: number[] = [];
    let calls = 0;
    const out = await retryWithBackoff(
      async () => {
        calls++;
        if (calls < 3) throw new Error("internal error");
        return "ok";
      },
      { attempts: 5, baseDelayMs: 10, maxDelayMs: 1_000, sleep: async (ms) => void slept.push(ms) },
    );
    expect(out).toBe("ok");
    expect(calls).toBe(3);
    expect(slept).toEqual([10, 20]);
  });

  it("rethrows the last error after the final attempt", async () => {
    let calls = 0;
    await expect(
      retryWithBackoff(
        async () => {
          calls++;
          throw new Error(`fail ${calls}`);
        },
        { attempts: 3, baseDelayMs: 1, maxDelayMs: 1, sleep: async () => {} },
      ),
    ).rejects.toThrow("fail 3");
    expect(calls).toBe(3);
  });

  it("stops at once when shouldRetry says the error is permanent", async () => {
    let calls = 0;
    await expect(
      retryWithBackoff(
        async () => {
          calls++;
          throw new Error("reverted");
        },
        { attempts: 5, baseDelayMs: 1, maxDelayMs: 1, sleep: async () => {}, shouldRetry: () => false },
      ),
    ).rejects.toThrow("reverted");
    expect(calls).toBe(1);
  });
});
