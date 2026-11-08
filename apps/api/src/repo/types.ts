/**
 * Read/write boundary between the HTTP layer and Postgres. Every method returns
 * schema-shaped domain objects (packages/sdk) so routes never touch rows directly,
 * and tests can swap in an in-memory implementation.
 */
import type {
  AgentProfile,
  BookSnapshot,
  EpochAttestation,
  EpochScore,
  Fill,
  GuardEvent,
  LiquiditySample,
  Market,
  NetworkName,
  Quote,
  TunerEvent,
} from "@strata/sdk";

export interface BaselineStats {
  marketId: string;
  spreadBps: number | null;
  depthUsd25: number;
  windowStart: number;
  windowEnd: number;
  samples: number;
}

export interface OracleReading {
  price: string;
  /** Oracle publish time in ms. */
  timestamp: number;
}

export interface Heartbeat {
  service: string;
  at: number;
  detail: Record<string, unknown>;
}

export interface EventQuery {
  agentId?: number;
  /** Inclusive lower bound on `at` in ms. */
  sinceMs?: number;
  limit: number;
}

export interface KillCommandInput {
  id: string;
  network: NetworkName;
  /** null means every agent on the network. */
  targetAgentId: number | null;
  closePositions: boolean;
  signer: string;
  nonce: string;
  requestedAt: number;
  signatureExpiresAt: number;
}

export type KillInsertResult = "inserted" | "nonce_reused";

export interface Repository {
  ping(): Promise<void>;

  listMarkets(network: NetworkName): Promise<Market[]>;
  getMarket(network: NetworkName, marketId: string): Promise<Market | null>;
  /** Most recent snapshot per market, any age. Callers decide freshness from `at`. */
  latestBooks(network: NetworkName): Promise<BookSnapshot[]>;
  latestBook(network: NetworkName, marketId: string): Promise<BookSnapshot | null>;
  /** Aggregates over BASELINE-provenance snapshots, one entry per market that has any. */
  baselineStats(network: NetworkName): Promise<BaselineStats[]>;
  liquidityHistory(network: NetworkName, marketId: string, sinceMs: number, bucketMs: number): Promise<LiquiditySample[]>;
  latestOracle(network: NetworkName, marketId: string): Promise<OracleReading | null>;

  listAgents(network: NetworkName): Promise<AgentProfile[]>;
  getAgent(network: NetworkName, agentId: number): Promise<AgentProfile | null>;
  /** Uncancelled orders posted at or after `sinceMs`. */
  liveQuotes(network: NetworkName, agentId: number, sinceMs: number): Promise<Quote[]>;
  /** Distinct agents with an uncancelled order posted at or after `sinceMs`. */
  quotingAgentCount(network: NetworkName, sinceMs: number): Promise<number>;
  recentFills(network: NetworkName, agentId: number, limit: number): Promise<Fill[]>;
  agentScores(network: NetworkName, agentId: number, limit: number): Promise<EpochScore[]>;
  guardEvents(network: NetworkName, query: EventQuery): Promise<GuardEvent[]>;
  tunerEvents(network: NetworkName, query: EventQuery): Promise<TunerEvent[]>;
  heartbeats(network: NetworkName): Promise<Heartbeat[]>;

  latestSeason(network: NetworkName): Promise<number | null>;
  /** Distinct epochs that have scores in a season, newest first. */
  scoredEpochs(network: NetworkName, season: number, limit: number): Promise<number[]>;
  epochScores(network: NetworkName, season: number, epoch: number): Promise<EpochScore[]>;
  listEpochs(network: NetworkName, limit: number): Promise<EpochAttestation[]>;
  getEpoch(network: NetworkName, season: number, epoch: number): Promise<EpochAttestation | null>;
  latestPostedEpoch(network: NetworkName): Promise<EpochAttestation | null>;

  /** Consumes the nonce and records the kill command atomically. */
  insertKillCommand(cmd: KillCommandInput): Promise<KillInsertResult>;
}
