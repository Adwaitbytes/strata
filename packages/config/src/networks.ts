/**
 * Network configuration (PRD 15.1). One object per network; services select by STRATA_NETWORK.
 *
 * EVM constants: verified from https://docs.injective.network/developers-evm/network-information
 * (PRD 4.3, also in the InjectiveLabs injective-evm-developer skill).
 * Indexer / chain gRPC endpoints are NOT hand-written here: they come from the official
 * `@injectivelabs/networks` package via `getNetworkEndpoints` at runtime (see services/*).
 * Contract addresses are filled from packages/contracts/deployments/<network>.json after deploy.
 */
import type { NetworkName } from "@strata/sdk";

export interface EvmNetwork {
  chainId: number;
  cosmosChainId: string;
  rpcUrls: readonly string[];
  wsUrl: string;
  explorer: string;
  explorerApi: string;
  faucets: readonly string[];
}

export interface StrataContracts {
  arena: `0x${string}` | null;
  attestor: `0x${string}` | null;
  rewards: `0x${string}` | null;
  /** ERC-8004 identity registry on Injective. null until verified from official docs (PRD 4.5). */
  identityRegistry: `0x${string}` | null;
  deployBlock: number | null;
}

export interface NetworkConfig {
  name: NetworkName;
  evm: EvmNetwork;
  /** Precompiles, PRD 4.3. */
  precompiles: { bank: `0x${string}`; exchange: `0x${string}` };
  /** Recommended legacy gas price in wei (PRD 4.4: type 0 tx, 160e6). */
  gasPriceWei: bigint;
  contracts: StrataContracts;
}

const BANK = "0x0000000000000000000000000000000000000064" as const;
const EXCHANGE = "0x0000000000000000000000000000000000000065" as const;

export const NETWORKS: Record<NetworkName, NetworkConfig> = {
  mainnet: {
    name: "mainnet",
    evm: {
      chainId: 1776,
      cosmosChainId: "injective-1",
      rpcUrls: ["https://sentry.evm-rpc.injective.network/"],
      wsUrl: "wss://sentry.evm-ws.injective.network",
      explorer: "https://blockscout.injective.network/",
      explorerApi: "https://blockscout-api.injective.network/api",
      faucets: [],
    },
    precompiles: { bank: BANK, exchange: EXCHANGE },
    gasPriceWei: 160_000_000n,
    contracts: { arena: null, attestor: null, rewards: null, identityRegistry: null, deployBlock: null },
  },
  testnet: {
    name: "testnet",
    evm: {
      chainId: 1439,
      cosmosChainId: "injective-888",
      rpcUrls: ["https://k8s.testnet.json-rpc.injective.network/"],
      wsUrl: "wss://k8s.testnet.ws.injective.network/",
      explorer: "https://testnet.blockscout.injective.network/",
      explorerApi: "https://testnet.blockscout-api.injective.network/api",
      faucets: ["https://testnet.faucet.injective.network/", "https://faucet.circle.com/"],
    },
    precompiles: { bank: BANK, exchange: EXCHANGE },
    gasPriceWei: 160_000_000n,
    contracts: { arena: null, attestor: null, rewards: null, identityRegistry: null, deployBlock: null },
  },
};

/** Deprecated network that must never be used (PRD 4.3). */
export const FORBIDDEN_CHAIN_IDS: readonly number[] = [2525];

/** Hard cap on mainnet house capital (D6). Raising it requires a code change and review. */
export const MAINNET_CAPITAL_CAP_USD = 1_000;

export function getNetwork(name: string | undefined): NetworkConfig {
  if (name !== "mainnet" && name !== "testnet") {
    throw new Error(`STRATA_NETWORK must be "mainnet" or "testnet", got ${String(name)}`);
  }
  return NETWORKS[name];
}
