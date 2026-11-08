/**
 * Read-only Injective Indexer access through official @injectivelabs/sdk-ts clients.
 * Narrow interface so recorders and tests can swap in recorded fixtures.
 */
import {
  IndexerGrpcDerivativesApi,
  IndexerGrpcDerivativesStream,
  IndexerGrpcOracleApi,
  IndexerGrpcOracleStream,
} from "@injectivelabs/sdk-ts";
import { IndexerOrder, IndexerPosition, IndexerTrade } from "../live/records.js";
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
  /** Newest-first page of trades in [startTime, endTime] (ms). */
  fetchTrades(q: { marketIds: readonly string[]; startTime?: number; endTime?: number; limit: number }): Promise<IndexerTrade[]>;
  fetchOrders(q: { subaccountId: string; marketIds: readonly string[] }): Promise<IndexerOrder[]>;
  fetchPositions(q: { subaccountId: string; marketIds: readonly string[] }): Promise<IndexerPosition[]>;
  streamTrades(marketIds: readonly string[], onTrade: (t: IndexerTrade) => void, h: StreamCallbacks, signal: AbortSignal): void;
  streamOrders(subaccountId: string, onOrder: (o: IndexerOrder) => void, h: StreamCallbacks, signal: AbortSignal): void;
  streamPositions(subaccountId: string, onPosition: (p: IndexerPosition) => void, h: StreamCallbacks, signal: AbortSignal): void;
}

export interface StreamCallbacks {
  onEnd: () => void;
  onError: (e: unknown) => void;
}

function statusHandlers(h: StreamCallbacks) {
  return {
    onEndCallback: () => h.onEnd(),
    onStatusCallback: (s: { code: number; details: string }) => h.onError(new Error(`stream status ${s.code}: ${s.details}`)),
  };
}

/** Parses one record; a malformed record is reported to the stream, not thrown into the SDK. */
function parseOr<T>(schema: { safeParse: (v: unknown) => { success: true; data: T } | { success: false; error: unknown } }, v: unknown, h: StreamCallbacks): T | null {
  const r = schema.safeParse(v);
  if (r.success) return r.data;
  h.onError(new Error(`malformed indexer record: ${String(r.error).slice(0, 200)}`));
  return null;
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
  const derivativesStream = new IndexerGrpcDerivativesStream(endpoint);

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
    async fetchTrades(q) {
      const res = await derivatives.fetchTrades({
        marketIds: [...q.marketIds],
        ...(q.startTime === undefined ? {} : { startTime: q.startTime }),
        ...(q.endTime === undefined ? {} : { endTime: q.endTime }),
        pagination: { limit: q.limit },
      });
      return res.trades.map((t) => IndexerTrade.parse(t));
    },
    async fetchOrders(q) {
      const res = await derivatives.fetchOrders({ subaccountId: q.subaccountId, marketIds: [...q.marketIds], pagination: { limit: 100 } });
      return res.orders.map((o) => IndexerOrder.parse(o));
    },
    async fetchPositions(q) {
      const res = await derivatives.fetchPositionsV2({ subaccountId: q.subaccountId, marketIds: [...q.marketIds], pagination: { limit: 100 } });
      return res.positions.map((p) => IndexerPosition.parse(p));
    },
    streamTrades(marketIds, onTrade, h, signal) {
      derivativesStream.streamTrades({
        marketIds: [...marketIds],
        callback: (r) => {
          const t = r.trade ? parseOr(IndexerTrade, r.trade, h) : null;
          if (t) onTrade(t);
        },
        ...statusHandlers(h),
        signal,
      });
    },
    streamOrders(subaccountId, onOrder, h, signal) {
      derivativesStream.streamOrders({
        subaccountId,
        callback: (r) => {
          const o = r.order ? parseOr(IndexerOrder, r.order, h) : null;
          if (o) onOrder(o);
        },
        ...statusHandlers(h),
        signal,
      });
    },
    streamPositions(subaccountId, onPosition, h, signal) {
      derivativesStream.streamPositionsV2({
        subaccountId,
        callback: (r) => {
          const p = r.position ? parseOr(IndexerPosition, r.position, h) : null;
          if (p) onPosition(p);
        },
        ...statusHandlers(h),
        signal,
      });
    },
  };
}
