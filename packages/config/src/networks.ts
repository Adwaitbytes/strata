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
    // ERC-8004 identity registry: github.com/InjectiveLabs/injective-agent-sdk packages/sdk/src/config.ts
    // (commit 381a270), ERC-721 supportsInterface checked live. STRATA contracts are not deployed on mainnet (D27).
    contracts: {
      arena: null,
      attestor: null,
      rewards: null,
      identityRegistry: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
      deployBlock: null,
    },
  },
  testnet: {
    name: "testnet",
    evm: {
      chainId: 1439,
      cosmosChainId: "injective-888",
      rpcUrls: ["https://k8s.testnet.json-rpc.injective.network/"],
      wsUrl: "wss://k8s.testnet.ws.injective.network/",
      explorer: "https://testnet.blockscout.injective.network/",
      // testnet.blockscout-api.injective.network does not resolve (checked 2026-11-09); the explorer host serves /api.
      explorerApi: "https://testnet.blockscout.injective.network/api",
      faucets: ["https://testnet.faucet.injective.network/", "https://faucet.circle.com/"],
    },
    precompiles: { bank: BANK, exchange: EXCHANGE },
    gasPriceWei: 160_000_000n,
    // From packages/contracts/deployments/testnet.json (W1 deploy, commit ed3a8cf). Sourcify exact match.
    // Identity registry: github.com/InjectiveLabs/injective-agent-sdk packages/sdk/src/config.ts (commit 381a270).
    contracts: {
      arena: "0x2046D580f7c710bEE8C8eFE46CB34ccFD1B40870",
      attestor: "0xfb73da045cDc792dCb9f8Dcdc300aeE348bff4DF",
      rewards: "0x917DeD5aEC9B5eE1EE8430A9f179D600A321d628",
      identityRegistry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
      deployBlock: 147653265,
    },
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
