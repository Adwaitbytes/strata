import { describe, expect, it, vi } from "vitest";
import { mockEpoch } from "./api/mock-data";
import { defaultSubaccountId } from "./chains";
import { verifyLocally, verifyOnchain } from "./verify";

const epoch = mockEpoch("testnet", 12)!;
const root = epoch.attestation.merkleRoot as `0x${string}`;
const score = epoch.scores[2]!;

describe("verifyLocally", () => {
  it("passes for a published score and proof", () => {
    expect(verifyLocally(score, root).status).toBe("pass");
  });

  it("fails when a field was altered", () => {
    const tampered = { ...score, score: score.score + 1 };
    expect(verifyLocally(tampered, root).status).toBe("fail");
  });

  it("fails against a different root", () => {
    expect(verifyLocally(score, `0x${"ab".repeat(32)}`).status).toBe("fail");
  });
});

describe("verifyOnchain", () => {
  it("is unavailable when the attestor is not deployed", async () => {
    const readContract = vi.fn();
    const r = await verifyOnchain(score, "testnet", null, { readContract });
    expect(r.status).toBe("unavailable");
    expect(readContract).not.toHaveBeenCalled();
  });

  it("passes the full leaf fields and proof to verifyScore", async () => {
    const readContract = vi.fn(async () => true);
    const attestor = `0x${"12".repeat(20)}` as const;
    const r = await verifyOnchain(score, "testnet", attestor, { readContract: readContract as never });
    expect(r.status).toBe("pass");
    const call = readContract.mock.calls[0] as unknown as [{ functionName: string; args: unknown[] }];
    expect(call[0].functionName).toBe("verifyScore");
    expect(call[0].args).toHaveLength(10);
    expect(call[0].args[9]).toEqual(score.proof);
  });

  it("reports RPC failures as unavailable, not as a failed proof", async () => {
    const readContract = vi.fn(async () => Promise.reject(new Error("timeout")));
    const r = await verifyOnchain(score, "testnet", `0x${"12".repeat(20)}`, { readContract: readContract as never });
    expect(r.status).toBe("unavailable");
  });
});

describe("defaultSubaccountId", () => {
  it("appends a 24 hex digit nonce", () => {
    const id = defaultSubaccountId("0xAbCdEf0123456789abcdef0123456789ABCDEF01");
    expect(id).toBe("0xabcdef0123456789abcdef0123456789abcdef01000000000000000000000000");
    expect(id).toHaveLength(66);
  });
});
