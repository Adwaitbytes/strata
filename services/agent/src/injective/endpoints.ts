/**
 * Endpoint sets per network. Nothing here is hand-written: every URL comes from the official
 * `@injectivelabs/networks` package (`getNetworkEndpoints`), using each published variant of the
 * network so callers can fail over when one sentry is down.
 */
import { Network, getNetworkEndpoints, getNetworkInfo } from "@injectivelabs/networks";
import type { NetworkEndpoints } from "@injectivelabs/networks";
import type { NetworkName } from "@strata/sdk";

/** Ordered by preference. Sentry first (the SDK default), then the k8s and load-balanced pools. */
const VARIANTS: Record<NetworkName, readonly Network[]> = {
  mainnet: [Network.Mainnet, Network.MainnetK8s, Network.MainnetLB],
  testnet: [Network.Testnet, Network.TestnetK8s],
};

export interface EndpointSet {
  network: NetworkName;
  /** SDK network enum used for chain id lookups. */
  sdkNetwork: Network;
  cosmosChainId: string;
  /** Deduplicated endpoint bundles, preferred first. */
  bundles: NetworkEndpoints[];
}

export function getEndpointSet(network: NetworkName): EndpointSet {
  const variants = VARIANTS[network];
  const primary = variants[0];
  if (primary === undefined) throw new Error(`no endpoint variants for ${network}`);
  const seen = new Set<string>();
  const bundles: NetworkEndpoints[] = [];
  for (const variant of variants) {
    const e = getNetworkEndpoints(variant);
    const key = `${e.indexer}|${e.grpc}|${e.rest}`;
    if (seen.has(key)) continue;
    seen.add(key);
    bundles.push(e);
  }
  return { network, sdkNetwork: primary, cosmosChainId: getNetworkInfo(primary).chainId, bundles };
}

/** Runs `fn` against each bundle in order until one succeeds. Throws the last error. */
export async function withFailover<T>(set: EndpointSet, fn: (e: NetworkEndpoints) => Promise<T>): Promise<T> {
  let last: unknown = new Error(`no endpoints for ${set.network}`);
  for (const bundle of set.bundles) {
    try {
      return await fn(bundle);
    } catch (err) {
      last = err;
    }
  }
  throw last;
}
