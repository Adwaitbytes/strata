/**
 * TESTNET ONLY. Waits until strata-test-1 is funded from the faucets, then sends gas INJ to
 * strata-test-2, strata-test-3, strata-options, strata-testnet-attestor and the W1 testnet deployer,
 * and splits test USDC / USDT among the agent wallets (strata-test-1 keeps 40%).
 * Refuses EVM chain 1776 and cosmos chain injective-1. Prints only addresses, amounts and tx hashes.
 *
 *   pnpm --filter @strata/agent inj:distribute               # wait, then send
 *   pnpm --filter @strata/agent inj:distribute -- --dry-run  # plan only
 *
 * Implementation: services/agent/src/injective/funding.ts
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const minutes = Number(args.find((a) => a.startsWith("--timeout-min="))?.split("=")[1] ?? "60");
  // Dynamic import: the implementation lives in an ESM package (services/agent), this file runs as CJS.
  const { distributeTestnetFunds } = await import("../services/agent/src/injective/funding.js");
  await distributeTestnetFunds({ dryRun: args.includes("--dry-run"), timeoutMs: minutes * 60_000 });
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    console.error(`distribute failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  },
);
