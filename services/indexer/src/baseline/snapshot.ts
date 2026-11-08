/** Builds one book_snapshots row from a raw Indexer orderbook and the latest oracle tick. */
import type { NetworkName, Provenance } from "@strata/sdk";
import { computeBookMetrics } from "../book/metrics.js";
import type { OracleTick, RawOrderbook } from "../injective/reader.js";
import type { CandidateMarket } from "../markets/select.js";
import type { BookSnapshotRow } from "../store/writes.js";

/**
 * Exchange session state is not exposed by the Indexer market record. Until the Session Guard
 * calendar (W2/W3) is wired in, baseline rows say so instead of guessing.
 */
export const SESSION_UNKNOWN = "unknown";

export function buildSnapshotRow(args: {
  network: NetworkName;
  provenance: Provenance;
  at: Date;
  market: CandidateMarket;
  orderbook: RawOrderbook;
  oracle: OracleTick | undefined;
  maxStoredLevels?: number;
}): BookSnapshotRow {
  const m = computeBookMetrics(args.orderbook, args.market.quoteDecimals, { maxStoredLevels: args.maxStoredLevels ?? 10 });
  return {
    network: args.network,
    marketId: args.market.marketId,
    at: args.at,
    provenance: args.provenance,
    mid: m.mid,
    spreadBps: m.spreadBps,
    depthUsd25: m.depthUsd25,
    strataDepthUsd25: m.strataDepthUsd25,
    bids: m.bids,
    asks: m.asks,
    oraclePrice: args.oracle?.price ?? null,
    oracleTs: args.oracle?.timestampMs != null ? new Date(args.oracle.timestampMs) : null,
    sessionState: SESSION_UNKNOWN,
  };
}
