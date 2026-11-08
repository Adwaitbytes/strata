/**
 * Indexer endpoints come only from the official @injectivelabs/networks package
 * (`getNetworkEndpoints(Network.Mainnet | Network.Testnet).indexer`), never hand-written.
 * Verified 2026-11-09 with @injectivelabs/networks 1.20.66:
 *   mainnet indexer https://sentry.exchange.grpc-web.injective.network
 *   testnet indexer https://testnet.sentry.exchange.grpc-web.injective.network
 */
import { getNetworkEndpoints, Network } from "@injectivelabs/networks";
import type { NetworkName } from "@strata/sdk";

export function injectiveNetwork(network: NetworkName): Network {
  return network === "mainnet" ? Network.Mainnet : Network.Testnet;
}

export function indexerEndpoint(network: NetworkName): string {
  return getNetworkEndpoints(injectiveNetwork(network)).indexer;
}
