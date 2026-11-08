/**
 * Arena market list. The generated JSON is written by `scripts/fetch-markets.ts` from a LIVE
 * Indexer query (PRD 4.5: never hardcode market IDs without a fetch script).
 * Until the fetch has run for a network, the list is empty and nothing quotes.
 */
import type { Market, NetworkName } from "@strata/sdk";
import mainnet from "./generated/markets.mainnet.json" with { type: "json" };
import testnet from "./generated/markets.testnet.json" with { type: "json" };

export function getMarkets(network: NetworkName): readonly Market[] {
  return (network === "mainnet" ? mainnet : testnet) as unknown as readonly Market[];
}
