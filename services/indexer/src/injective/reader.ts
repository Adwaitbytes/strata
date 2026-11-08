/**
 * Read-only Injective Indexer access through official @injectivelabs/sdk-ts clients.
 * Narrow interface so recorders and tests can swap in recorded fixtures.
 */
import {
  IndexerGrpcDerivativesApi,
  IndexerGrpcOracleApi,
  IndexerGrpcOracleStream,
} from "@injectivelabs/sdk-ts";
import type { NetworkName } from "@strata/sdk";
import { indexerEndpoint } from "./endpoints.js";

export interface RawDerivativeMarket {
  marketId: string;
  ticker: string;
  marketStatus: string;
  isPerpetual: boolean;
  oracleType: string;
  oracleBase: string;
  oracleQuote: string;
  oracleScaleFactor: number;
  quoteDenom: string;
  quoteDecimals: number;
  raw: unknown;
}

export interface RawOrderbook {
  marketId: string;
  sequence: number;
  buys: { price: string; quantity: string }[];
  sells: { price: string; quantity: string }[];
}

export interface OracleTick {
  marketId: string;
  price: string;
  /** Oracle publish time in ms, or null when only the polled price is known. */
  timestampMs: number | null;
}

export interface InjectiveReader {
  fetchMarkets(): Promise<RawDerivativeMarket[]>;
  fetchOrderbooks(marketIds: readonly string[]): Promise<RawOrderbook[]>;
  fetchOraclePrices(markets: readonly RawDerivativeMarket[]): Promise<OracleTick[]>;
  streamOraclePrices(
    marketIds: readonly string[],
    onTick: (t: OracleTick) => void,
    handlers: { onEnd: () => void; onError: (e: unknown) => void },
    signal: AbortSignal,
  ): void;
}

/** Indexer rejects more than 100 market IDs per orderbooks request (observed live 2026-11-09). */
export const ORDERBOOK_BATCH = 100;
const ORACLE_BATCH = 100;

function chunk<T>(xs: readonly T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

export function createInjectiveReader(network: NetworkName): InjectiveReader {
  const endpoint = indexerEndpoint(network);
  const derivatives = new IndexerGrpcDerivativesApi(endpoint);
  const oracle = new IndexerGrpcOracleApi(endpoint);
  const oracleStream = new IndexerGrpcOracleStream(endpoint);

  return {
    async fetchMarkets() {
      const markets = await derivatives.fetchMarkets({ marketStatus: "active" });
      // fetchMarkets is typed as a perpetual | expiry | binary-options union; binary options
      // markets have no oracleBase/oracleQuote and are not arena candidates.
      return markets.flatMap((m) => ("oracleBase" in m && "isPerpetual" in m ? [m] : [])).map((m) => ({
        marketId: m.marketId,
        ticker: m.ticker,
        marketStatus: m.marketStatus,
        isPerpetual: m.isPerpetual,
        oracleType: m.oracleType,
        oracleBase: m.oracleBase,
        oracleQuote: m.oracleQuote,
        oracleScaleFactor: m.oracleScaleFactor,
        quoteDenom: m.quoteDenom,
        quoteDecimals: m.quoteToken?.decimals ?? 6,
        raw: m,
      }));
    },
    async fetchOrderbooks(marketIds) {
      const batches = await Promise.all(chunk(marketIds, ORDERBOOK_BATCH).map((ids) => derivatives.fetchOrderbooksV2(ids)));
      return batches.flat().map((r) => ({ marketId: r.marketId, sequence: r.orderbook.sequence, buys: r.orderbook.buys, sells: r.orderbook.sells }));
    },
    async fetchOraclePrices(markets) {
      const out: OracleTick[] = [];
      for (const batch of chunk(markets, ORACLE_BATCH)) {
        const res = await oracle.fetchOraclePriceV2(
          batch.map((m) => ({ baseSymbol: m.oracleBase, quoteSymbol: m.oracleQuote, oracleType: m.oracleType, oracleScaleFactor: m.oracleScaleFactor })),
        );
        for (const r of res) if (r.marketId && r.price) out.push({ marketId: r.marketId, price: r.price, timestampMs: null });
      }
      return out;
    },
    streamOraclePrices(marketIds, onTick, handlers, signal) {
      oracleStream.streamOraclePricesByMarkets({
        marketIds: [...marketIds],
        callback: (r) => {
          const ts = Number(r.timestamp);
          onTick({ marketId: r.marketId, price: r.price, timestampMs: Number.isFinite(ts) && ts > 0 ? ts : null });
        },
        onEndCallback: () => handlers.onEnd(),
        onStatusCallback: (s) => handlers.onError(new Error(`stream status ${s.code}: ${s.details}`)),
        signal,
      });
    },
  };
}
