/**
 * Prints INJ / USDC / USDT bank balances and subaccount deposits for the STRATA testnet wallets.
 * Addresses and amounts only.  pnpm --filter @strata/agent inj:balances
 */
import { IndexerGrpcAccountApi, getSubaccountId } from "@injectivelabs/sdk-ts";
import { defaultSecretsDir, evmToInjAddress } from "@strata/keys";
import { getEndpointSet, withFailover } from "../endpoints.js";
import { EvmRpc } from "../evm.js";
import { defaultRecipients, fmt, keystoreAddress, readBalances } from "../funding.js";
import { keystorePath } from "@strata/keys";

const evm = new EvmRpc("testnet");
const set = getEndpointSet("testnet");
const test1 = await keystoreAddress(keystorePath(defaultSecretsDir(), "strata-test-1"));
const wallets = [{ name: "strata-test-1", evmAddress: test1, injAddress: evmToInjAddress(test1) }, ...(await defaultRecipients())];
for (const w of wallets) {
  const b = await readBalances(evm, w.evmAddress, w.injAddress);
  const sub = getSubaccountId(w.injAddress, 0);
  const deposits = await withFailover(set, (e) => new IndexerGrpcAccountApi(e.indexer).fetchSubaccountBalancesList(sub)).catch(() => []);
  const dep = deposits.map((d) => `${d.denom.slice(0, 18)}=${d.deposit?.availableBalance ?? "?"}/${d.deposit?.totalBalance ?? "?"}`).join(" ");
  console.log(`${w.name.padEnd(24)} ${w.evmAddress} INJ=${fmt(b.injWei, 18)} USDC=${fmt(b.usdc, 6)} USDT=${fmt(b.usdt, 6)} sub0[${dep}]`);
}
