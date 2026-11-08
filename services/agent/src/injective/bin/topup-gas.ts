/**
 * TESTNET ONLY. Sends INJ for gas from a faucet-funded wallet to the STRATA house agents.
 * Prints only addresses, amounts and tx hashes. Refuses any chain other than EVM 1439.
 *
 *   pnpm --filter @strata/agent inj:topup -- <source-keystore-name> <amountPerAgentInj> <agent-name>...
 */
import { assertTestnet, fmt, keystoreAddress } from "../funding.js";
import { EvmRpc } from "../evm.js";
import { KeystoreKeySource, defaultSecretsDir, keystorePath } from "@strata/keys";

const INJ = 10n ** 18n;

function parseInj(amount: string): bigint {
  if (!/^\d+(\.\d{1,18})?$/.test(amount)) throw new Error(`invalid INJ amount: ${amount}`);
  const [whole, frac = ""] = amount.split(".");
  return BigInt(whole ?? "0") * INJ + BigInt(frac.padEnd(18, "0"));
}

async function main(): Promise<void> {
  const [sourceName, amountArg, ...agents] = process.argv.slice(2).filter((a) => a !== "--");
  if (!sourceName || !amountArg || agents.length === 0) {
    throw new Error("usage: topup-gas <source> <amountPerAgentInj> <agent-name>...");
  }
  const amount = parseInj(amountArg);
  const evm = new EvmRpc("testnet");
  await assertTestnet(evm);

  const source = await new KeystoreKeySource().load(sourceName);
  let nonce = await evm.nonce(source.evmAddress);
  for (const agent of agents) {
    const to = await keystoreAddress(keystorePath(defaultSecretsDir(), agent));
    const hash = await evm.sendLegacy(source, { to, value: amount, gasLimit: 21_000n, nonce });
    nonce += 1;
    const receipt = await evm.waitForReceipt(hash, 90_000).catch(() => null);
    console.log(`${fmt(amount, 18)} INJ -> ${agent} ${to} tx ${hash} ${receipt?.status ?? "receipt pending"}`);
  }
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    console.error(`topup failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  },
);
