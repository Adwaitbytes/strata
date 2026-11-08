/**
 * Chain oracle reads with report timestamps.
 *
 * The Indexer oracle API returns prices without timestamps, and the Oracle Guard (PRD 9.4) needs
 * the report time. So we call the chain oracle module directly over gRPC-web using the generated
 * client from `@injectivelabs/core-proto-ts-v2` (the same proto package sdk-ts is built on):
 *  - `OraclePrice` (pythpro, chainlinkdatastreams, pricefeed, ...) returns base/quote prices and
 *    base/quote timestamps (injective/oracle/v1beta1/query.proto, QueryOraclePriceResponse).
 *  - `ProviderPriceState` for the provider oracle type (docs.injective.network/developers-defi/provider-oracle),
 *    keyed by provider name (market oracleQuote) and symbol (market oracleBase).
 * Price values are cosmos `Dec` (18 decimal places) encoded as integer strings.
 */
import { GrpcWebFetchTransport } from "@protobuf-ts/grpcweb-transport";
import { QueryClient } from "@injectivelabs/core-proto-ts-v2/generated/injective/oracle/v1beta1/query_pb.client";
import { OracleType } from "@injectivelabs/core-proto-ts-v2/generated/injective/oracle/v1beta1/oracle_pb";
import { decFromChain } from "./units.js";

export interface OracleRef {
  /** As reported by the Indexer, e.g. "pythpro", "provider", "chainlinkdatastreams". */
  oracleType: string;
  oracleBase: string;
  oracleQuote: string;
}

export interface OracleReading {
  /** Human-unit decimal string. */
  price: string;
  /** Oldest of the contributing report timestamps, ms. */
  timestampMs: number;
  source: string;
}

export function parseOracleType(raw: string): OracleType {
  const wanted = raw.toLowerCase();
  for (const [name, value] of Object.entries(OracleType)) {
    if (typeof value === "number" && name.toLowerCase() === wanted) return value as OracleType;
  }
  throw new Error(`unknown oracle type "${raw}"`);
}

const clients = new Map<string, QueryClient>();
function clientFor(grpcEndpoint: string): QueryClient {
  let c = clients.get(grpcEndpoint);
  if (c === undefined) {
    c = new QueryClient(new GrpcWebFetchTransport({ baseUrl: grpcEndpoint }));
    clients.set(grpcEndpoint, c);
  }
  return c;
}

export async function readOracle(grpcEndpoint: string, ref: OracleRef, timeoutMs = 5_000): Promise<OracleReading> {
  const client = clientFor(grpcEndpoint);
  const type = parseOracleType(ref.oracleType);
  const opts = { timeout: timeoutMs };
  if (type === OracleType.Provider) {
    const { response } = await client.providerPriceState({ provider: ref.oracleQuote, symbol: ref.oracleBase }, opts);
    const state = response.priceState;
    if (state === undefined) throw new Error(`no provider price for ${ref.oracleQuote}/${ref.oracleBase}`);
    return {
      price: decFromChain(state.price),
      timestampMs: Number(state.timestamp) * 1000,
      source: `injective-oracle:provider:${ref.oracleQuote}:${ref.oracleBase}`,
    };
  }
  const { response } = await client.oraclePrice({ oracleType: type, base: ref.oracleBase, quote: ref.oracleQuote }, opts);
  const pair = response.pricePairState;
  if (pair === undefined) throw new Error(`no oracle price for ${ref.oracleType} ${ref.oracleBase}/${ref.oracleQuote}`);
  const ts = Math.min(Number(pair.baseTimestamp), Number(pair.quoteTimestamp));
  return {
    price: decFromChain(pair.pairPrice),
    timestampMs: ts * 1000,
    source: `injective-oracle:${ref.oracleType}:${ref.oracleBase}/${ref.oracleQuote}`,
  };
}
