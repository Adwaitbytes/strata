/**
 * Grants (or revokes) a scoped trading permission: the grantee hot key may only send
 * MsgBatchUpdateOrders for the granter's subaccount on the listed derivative markets.
 * It can never withdraw, send or transfer. See ../authz.ts and docs/INJECTIVE.md.
 *
 *   pnpm --filter @strata/agent inj:grant-trading -- --granter strata-test-2 --grantee strata-test-3 [--markets arena|<id,id>] [--subaccount 0] [--days 7]
 *   pnpm --filter @strata/agent inj:grant-trading -- --granter strata-test-2 --grantee strata-test-3 --revoke
 *   add --check to also prove the grantee CANNOT send funds (simulated MsgExec(MsgSend) must fail).
 *
 * Testnet by default. Mainnet requires --network mainnet AND STRATA_ALLOW_MAINNET=yes (owner action).
 */
import { MsgAuthzExec, MsgSend, getSubaccountId } from "@injectivelabs/sdk-ts";
import { getMarkets } from "@strata/config";
import { KeystoreKeySource, evmToInjAddress } from "@strata/keys";
import type { NetworkName } from "@strata/sdk";
import { buildTradingGrant, buildTradingRevoke } from "../authz.js";
import { getEndpointSet } from "../endpoints.js";
import { CosmosSigner, TxFailedError } from "../tx.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const flag = (name: string): boolean => process.argv.includes(`--${name}`);

async function resolveAddress(source: KeystoreKeySource, nameOrAddress: string): Promise<string> {
  if (nameOrAddress.startsWith("inj1")) return nameOrAddress;
  if (nameOrAddress.startsWith("0x")) return evmToInjAddress(nameOrAddress);
  return (await source.load(nameOrAddress)).injAddress;
}

async function main(): Promise<void> {
  const network = (arg("network") ?? "testnet") as NetworkName;
  if (network !== "testnet" && network !== "mainnet") throw new Error("--network must be testnet or mainnet");
  if (network === "mainnet" && process.env.STRATA_ALLOW_MAINNET !== "yes") throw new Error("mainnet grants need STRATA_ALLOW_MAINNET=yes (owner action)");

  const granterName = arg("granter");
  const granteeArg = arg("grantee");
  if (granterName === undefined || granteeArg === undefined) throw new Error("--granter <key> and --grantee <key|inj1|0x> are required");

  const source = new KeystoreKeySource();
  const granterKey = await source.load(granterName);
  const grantee = await resolveAddress(source, granteeArg);
  const signer = new CosmosSigner(getEndpointSet(network), granterKey);

  if (flag("revoke")) {
    const res = await signer.broadcast(buildTradingRevoke(granterKey.injAddress, grantee), { memo: "strata:revoke-trading" });
    console.log(`revoked MsgBatchUpdateOrders grant ${granterKey.injAddress} -> ${grantee}: tx ${res.txHash}`);
    return;
  }

  const marketsArg = arg("markets") ?? "arena";
  const marketIds = marketsArg === "arena" ? getMarkets(network).filter((m) => m.arenaEnabled).map((m) => m.marketId) : marketsArg.split(",");
  const subaccountId = getSubaccountId(granterKey.injAddress, Number(arg("subaccount") ?? "0"));
  const days = Number(arg("days") ?? "7");

  const msg = buildTradingGrant({ granter: granterKey.injAddress, grantee, subaccountId, derivativeMarketIds: marketIds, expirySeconds: Math.round(days * 86_400) });
  const res = await signer.broadcast(msg, { memo: "strata:grant-trading" });
  console.log(`granted BatchUpdateOrdersAuthz ${granterKey.injAddress} -> ${grantee}`);
  console.log(`  subaccount ${subaccountId}, ${marketIds.length} markets, ${days} days: tx ${res.txHash}`);

  if (flag("check")) {
    const granteeName = granteeArg.startsWith("inj1") || granteeArg.startsWith("0x") ? undefined : granteeArg;
    if (granteeName === undefined) throw new Error("--check needs --grantee as a key name");
    const granteeKey = await source.load(granteeName);
    const steal = MsgAuthzExec.fromJSON({
      grantee: granteeKey.injAddress,
      msgs: MsgSend.fromJSON({ srcInjectiveAddress: granterKey.injAddress, dstInjectiveAddress: granteeKey.injAddress, amount: { denom: "inj", amount: "1" } }),
    });
    try {
      await new CosmosSigner(getEndpointSet(network), granteeKey).broadcast(steal, { memo: "strata:authz-negative-check" });
      throw new Error("SECURITY: grantee was able to send funds from the granter");
    } catch (err) {
      if (err instanceof TxFailedError) console.log(`  check ok: grantee cannot send funds (${err.message.slice(0, 160)})`);
      else throw err;
    }
  }
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    console.error(`grant failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  },
);
