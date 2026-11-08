/**
 * viem chain definitions built from @strata/config (chain IDs, RPCs and explorers verified in
 * PRD 4.3 from https://docs.injective.network/developers-evm/network-information).
 * INJ is the native gas token with 18 decimals on Injective EVM (same source).
 */
import { NETWORKS } from "@strata/config";
import type { NetworkName } from "@strata/sdk";
import { defineChain, type Chain } from "viem";

function toChain(name: NetworkName): Chain {
  const n = NETWORKS[name];
  return defineChain({
    id: n.evm.chainId,
    name: name === "mainnet" ? "Injective EVM" : "Injective EVM Testnet",
    nativeCurrency: { name: "Injective", symbol: "INJ", decimals: 18 },
    rpcUrls: { default: { http: [...n.evm.rpcUrls] } },
    blockExplorers: { default: { name: "Blockscout", url: n.evm.explorer.replace(/\/$/, "") } },
    testnet: name === "testnet",
  });
}

export const injectiveTestnet = toChain("testnet");
export const injectiveMainnet = toChain("mainnet");

export const CHAINS: Record<NetworkName, Chain> = { testnet: injectiveTestnet, mainnet: injectiveMainnet };

export function explorerUrl(network: NetworkName, kind: "address" | "tx", value: string): string {
  return `${NETWORKS[network].evm.explorer.replace(/\/$/, "")}/${kind}/${value}`;
}

/**
 * Default Injective subaccount for an EVM address: the 20-byte address followed by the
 * 12-byte nonce, hex encoded (source: .claude/skills/injective-funding/SKILL.md,
 * "Subaccount ID Calculation": eth_address + nonce padded to 24 hex chars).
 */
export function defaultSubaccountId(address: `0x${string}`, nonce = 0): `0x${string}` {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error("expected a 20-byte EVM address");
  return `${address.toLowerCase()}${nonce.toString(16).padStart(24, "0")}` as `0x${string}`;
}
