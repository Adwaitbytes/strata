/**
 * Row to domain mapping. Every row is validated against its sdk schema; a row that fails is
 * dropped and reported, so one bad write upstream can never put a malformed number on screen.
 */
import { z, type ZodType, type ZodTypeDef } from "zod";
import {
  AgentProfile,
  BookSnapshot,
  EpochAttestation,
  EpochScore,
  Fill,
  GuardEvent,
  Market,
  Quote,
  ScoreFlag,
  TunerEvent,
  type ScoreFlagName,
} from "@strata/sdk";
import type { schema } from "@strata/db";

export type InvalidRowReporter = (table: string, issues: string) => void;

type Row<T extends { $inferSelect: unknown }> = T["$inferSelect"];

const ms = (d: Date): number => d.getTime();
const msOrNull = (d: Date | null): number | null => (d ? d.getTime() : null);

export function makeMapper<T>(table: string, schemaT: ZodType<T, ZodTypeDef, unknown>, report: InvalidRowReporter) {
  return (candidate: unknown): T | null => {
    const r = schemaT.safeParse(candidate);
    if (r.success) return r.data;
    report(table, r.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    return null;
  };
}

export function compact<T>(xs: Array<T | null>): T[] {
  return xs.filter((x): x is T => x !== null);
}

export function flagNames(flags: number): string[] {
  return (Object.keys(ScoreFlag) as ScoreFlagName[]).filter((k) => (flags & ScoreFlag[k]) !== 0);
}

const JsonObject = z.record(z.string(), z.unknown());

export function marketCandidate(r: Row<typeof schema.markets>): unknown {
  const data = JsonObject.safeParse(r.data);
  return { ...(data.success ? data.data : {}), network: r.network, marketId: r.marketId, ticker: r.ticker, arenaEnabled: r.arenaEnabled, fetchedAt: ms(r.fetchedAt) };
}

export function agentCandidate(r: Row<typeof schema.agents>): unknown {
  return {
    network: r.network,
    agentId: r.agentId,
    name: r.name,
    kind: r.kind,
    operator: r.operator,
    injAddress: r.injAddress,
    subaccountId: r.subaccountId,
    erc8004Id: r.erc8004Id,
    metadataURI: r.metadataUri,
    marketIds: r.marketIds,
    status: r.status,
    statusReason: r.statusReason,
    enrolledAt: ms(r.enrolledAt),
    simulated: r.simulated,
  };
}

export function bookCandidate(r: Row<typeof schema.bookSnapshots>): unknown {
  return {
    network: r.network,
    provenance: r.provenance,
    marketId: r.marketId,
    bids: r.bids,
    asks: r.asks,
    mid: r.mid,
    spreadBps: r.spreadBps,
    depthUsd25: r.depthUsd25,
    strataDepthUsd25: r.strataDepthUsd25,
    oraclePrice: r.oraclePrice,
    oracleTimestamp: msOrNull(r.oracleTs),
    sessionState: r.sessionState,
    at: ms(r.at),
  };
}

export function quoteCandidate(r: Row<typeof schema.agentOrders>): unknown {
  return {
    network: r.network,
    provenance: r.provenance,
    agentId: r.agentId,
    marketId: r.marketId,
    orderHash: r.orderHash,
    side: r.side,
    price: r.price,
    quantity: r.quantity,
    level: r.level,
    postedAt: ms(r.postedAt),
    cancelledAt: msOrNull(r.cancelledAt),
  };
}

export function fillCandidate(r: Row<typeof schema.agentFills>): unknown {
  return {
    network: r.network,
    provenance: r.provenance,
    agentId: r.agentId,
    marketId: r.marketId,
    orderHash: r.orderHash,
    tradeId: r.tradeId,
    txHash: r.txHash,
    eventIndex: r.eventIndex,
    side: r.side,
    price: r.price,
    quantity: r.quantity,
    feeUsd: r.feeUsd,
    isMaker: r.isMaker,
    counterpartySubaccountId: r.counterpartySubaccountId,
    executedAt: ms(r.executedAt),
  };
}

export function guardCandidate(r: Row<typeof schema.guardEvents>): unknown {
  return {
    network: r.network,
    provenance: r.provenance,
    id: r.id,
    agentId: r.agentId,
    marketId: r.marketId,
    guard: r.guard,
    action: r.action,
    reason: r.reason,
    detail: r.detail,
    observed: r.observed,
    at: ms(r.at),
  };
}

/** tuner_events keeps the variable part of TunerEvent in `payload`; the columns win on overlap. */
export function tunerCandidate(r: Row<typeof schema.tunerEvents>): unknown {
  const payload = JsonObject.safeParse(r.payload);
  return { ...(payload.success ? payload.data : {}), network: r.network, id: r.id, agentId: r.agentId, marketId: r.marketId, mode: r.mode, model: r.model, at: ms(r.at) };
}

export function scoreCandidate(r: Row<typeof schema.scores>): unknown {
  return {
    network: r.network,
    provenance: r.provenance,
    season: r.season,
    epoch: r.epoch,
    agentId: r.agentId,
    score: r.score,
    metrics: r.metrics,
    flags: r.flags,
    flagNames: flagNames(r.flags),
    leaf: r.leaf,
    proof: r.proof,
  };
}

export function epochCandidate(r: Row<typeof schema.epochs>): unknown {
  return {
    network: r.network,
    season: r.season,
    epoch: r.epoch,
    startTime: ms(r.startTime),
    endTime: ms(r.endTime),
    merkleRoot: r.merkleRoot,
    dataURI: r.dataUri,
    txHash: r.txHash,
    postedAt: msOrNull(r.postedAt),
    contract: r.contract,
  };
}

export const Schemas = { Market, AgentProfile, BookSnapshot, Quote, Fill, GuardEvent, TunerEvent, EpochScore, EpochAttestation };
