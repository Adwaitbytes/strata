import { describe, expect, it } from "vitest";
import { killRequestMessage } from "./api.js";

describe("killRequestMessage", () => {
  it("builds the canonical EIP-191 text signed by the owner wallet", () => {
    const msg = killRequestMessage({ target: 3, closePositions: true, network: "testnet", nonce: "n-0123456789abcdef", expiresAt: 1_800_000_060_000 });
    expect(msg).toBe(
      ["STRATA kill request", "network: testnet", "target: 3", "closePositions: true", "nonce: n-0123456789abcdef", "expiresAt: 1800000060000"].join("\n"),
    );
  });

  it("renders the all-agents target", () => {
    expect(killRequestMessage({ target: "all", closePositions: false, network: "mainnet", nonce: "x".repeat(16), expiresAt: 1 })).toContain("target: all\n");
  });
});
