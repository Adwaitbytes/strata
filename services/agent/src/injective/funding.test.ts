import { describe, expect, it } from "vitest";
import { assertTestnet, planDistribution } from "./funding.js";
import type { Balances, Recipient } from "./funding.js";
import { EvmRpc } from "./evm.js";
import { backoffDelay } from "./retry.js";

const INJ = 10n ** 18n;
const zero: Balances = { injWei: 0n, usdc: 0n, usdt: 0n };
const r = (name: string, stableShare: number, balances: Balances = zero): Recipient & { balances: Balances } => ({
  name,
  evmAddress: `0x${name.length.toString(16).padStart(40, "0")}`,
  injAddress: `inj1${name}`,
  stableShare,
  balances,
});

describe("planDistribution", () => {
  const recipients = [r("t2", 0.2), r("t3", 0.2), r("opt", 0.2), r("att", 0), r("dep", 0)];

  it("splits gas from 1 INJ, keeping a reserve and a share for the source", () => {
    const steps = planDistribution({ injWei: INJ, usdc: 0n, usdt: 0n }, recipients);
    const gas = steps.filter((s) => s.kind === "inj");
    expect(gas).toHaveLength(5);
    const total = gas.reduce((a, s) => a + s.amount, 0n);
    expect(INJ - total).toBeGreaterThanOrEqual((3n * INJ) / 10n);
  });

  it("caps gas grants at 0.25 INJ", () => {
    const steps = planDistribution({ injWei: 100n * INJ, usdc: 0n, usdt: 0n }, recipients);
    for (const s of steps) expect(s.amount).toBe(INJ / 4n);
  });

  it("splits stablecoins 20/20/20 and keeps 40 percent on the source; gas-only wallets get none", () => {
    const steps = planDistribution({ injWei: 0n, usdc: 10_000_000n, usdt: 5_000_000n }, recipients);
    const usdc = steps.filter((s) => s.kind === "usdc");
    expect(usdc.map((s) => s.to)).toEqual(["t2", "t3", "opt"]);
    expect(usdc.every((s) => s.amount === 2_000_000n)).toBe(true);
    const usdt = steps.filter((s) => s.kind === "usdt");
    expect(usdt.every((s) => s.toAddress.startsWith("inj1"))).toBe(true);
  });

  it("is idempotent: funded recipients are skipped", () => {
    const funded = recipients.map((x) => ({ ...x, balances: { injWei: INJ, usdc: 1n, usdt: 1n } }));
    expect(planDistribution({ injWei: 10n * INJ, usdc: 10n, usdt: 10n }, funded)).toEqual([]);
  });

  it("sends nothing when the source only has its reserve", () => {
    expect(planDistribution({ injWei: (3n * INJ) / 10n, usdc: 0n, usdt: 0n }, recipients)).toEqual([]);
  });
});

describe("assertTestnet", () => {
  it("refuses a mainnet client before any network call", async () => {
    await expect(assertTestnet(new EvmRpc("mainnet"))).rejects.toThrow(/testnet only/);
  });
});

describe("backoffDelay", () => {
  it("grows exponentially and respects the cap", () => {
    const max = () => 1;
    expect(backoffDelay(0, 100, 5_000, max)).toBe(100);
    expect(backoffDelay(3, 100, 5_000, max)).toBe(800);
    expect(backoffDelay(10, 100, 5_000, max)).toBe(5_000);
    expect(backoffDelay(5, 100, 5_000, () => 0)).toBe(0);
  });
});
