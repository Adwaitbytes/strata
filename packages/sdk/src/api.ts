/**
 * REST response and WebSocket message schemas (PRD Section 11.2, 11.3, 19.2).
 * apps/api validates outgoing payloads with these; apps/web validates incoming ones.
 */
import { z } from "zod";
import {
  AgentProfile,
  BookSnapshot,
  EpochAttestation,
  EpochScore,
  EvmAddress,
  Fill,
  GuardEvent,
  Hex32,
  LeaderboardRow,
  LiquiditySample,
  Market,
  NetworkName,
  Provenance,
  Quote,
  SessionState,
  TimestampMs,
  TunerEvent,
} from "./types.js";

export const API_VERSION = "v1" as const;

export const ApiError = z.object({
  error: z.object({
    code: z.enum(["bad_request", "not_found", "rate_limited", "unauthorized", "internal", "unavailable"]),
    message: z.string(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

export const NetworkQuery = z.object({ network: NetworkName.default("mainnet") });

/** GET /v1/markets */
export const MarketSummary = z.object({
  market: Market,
  now: z.object({
    spreadBps: z.number().nonnegative().nullable(),
    depthUsd25: z.number().nonnegative(),
    strataDepthUsd25: z.number().nonnegative(),
    strataBookShare: z.number().min(0).max(1),
    sessionState: SessionState,
    at: TimestampMs,
    provenance: Provenance,
  }).nullable(),
  baseline: z.object({
    spreadBps: z.number().nonnegative().nullable(),
    depthUsd25: z.number().nonnegative(),
    windowStart: TimestampMs,
    windowEnd: TimestampMs,
    samples: z.number().int().nonnegative(),
  }).nullable(),
});
export type MarketSummary = z.infer<typeof MarketSummary>;
export const MarketsResponse = z.object({ network: NetworkName, markets: z.array(MarketSummary), at: TimestampMs });
export type MarketsResponse = z.infer<typeof MarketsResponse>;

/** GET /v1/markets/:id */
export const MarketDetailResponse = z.object({
  summary: MarketSummary,
  book: BookSnapshot.nullable(),
  history: z.array(LiquiditySample),
  oracle: z.object({
    price: z.string().nullable(),
    timestamp: TimestampMs.nullable(),
    ageSec: z.number().nullable(),
    healthy: z.boolean(),
  }),
});
export type MarketDetailResponse = z.infer<typeof MarketDetailResponse>;

/** GET /v1/agents */
export const AgentsResponse = z.object({ network: NetworkName, agents: z.array(AgentProfile), at: TimestampMs });
export type AgentsResponse = z.infer<typeof AgentsResponse>;

/** GET /v1/agents/:id */
export const AgentDetailResponse = z.object({
  agent: AgentProfile,
  liveQuotes: z.array(Quote),
  recentFills: z.array(Fill),
  scores: z.array(EpochScore),
  guardEvents: z.array(GuardEvent),
  tunerEvents: z.array(TunerEvent),
  limits: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])),
});
export type AgentDetailResponse = z.infer<typeof AgentDetailResponse>;

/** GET /v1/leaderboard?season=&network= */
export const LeaderboardResponse = z.object({
  network: NetworkName,
  season: z.number().int().nonnegative(),
  epoch: z.number().int().nonnegative().nullable(),
  seasonEndsAt: TimestampMs.nullable(),
  rows: z.array(LeaderboardRow),
  at: TimestampMs,
});
export type LeaderboardResponse = z.infer<typeof LeaderboardResponse>;

/** GET /v1/epochs/:season/:epoch */
export const EpochResponse = z.object({
  attestation: EpochAttestation,
  scores: z.array(EpochScore),
});
export type EpochResponse = z.infer<typeof EpochResponse>;

/** GET /v1/epochs?network= (latest attestations, Transparency page) */
export const EpochListResponse = z.object({ network: NetworkName, epochs: z.array(EpochAttestation) });
export type EpochListResponse = z.infer<typeof EpochListResponse>;

/** GET /v1/transparency?network= */
export const TransparencyResponse = z.object({
  network: NetworkName,
  contracts: z.object({ arena: EvmAddress.nullable(), attestor: EvmAddress.nullable(), rewards: EvmAddress.nullable() }),
  houseAgents: z.array(z.object({
    agentId: z.number().int().positive(),
    name: z.string(),
    injAddress: z.string(),
    capitalUsd: z.number().nonnegative(),
    limits: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])),
  })),
  guardEvents: z.array(GuardEvent),
  suspensions: z.array(z.object({ agentId: z.number().int().positive(), reason: z.string(), at: TimestampMs })),
  epochs: z.array(EpochAttestation),
});
export type TransparencyResponse = z.infer<typeof TransparencyResponse>;

/** GET /v1/status */
export const ServiceHealth = z.object({
  name: z.string(),
  ok: z.boolean(),
  detail: z.string(),
  lastSeenAt: TimestampMs.nullable(),
});
export const StatusResponse = z.object({
  network: NetworkName,
  services: z.array(ServiceHealth),
  lastBlockHeight: z.number().int().nonnegative().nullable(),
  dataLagSec: z.number().nonnegative().nullable(),
  lastEpochPosted: EpochAttestation.nullable(),
  at: TimestampMs,
});
export type StatusResponse = z.infer<typeof StatusResponse>;

/** GET /v1/stats (Landing hero strip). Every field null when not live. */
export const HeroStatsResponse = z.object({
  network: NetworkName,
  provenance: Provenance,
  agentsLive: z.number().int().nonnegative(),
  marketsCovered: z.number().int().nonnegative(),
  strataDepthUsd25: z.number().nonnegative(),
  spreadImprovementBps: z.number().nullable(),
  /** Per-market depth layers that drive the 3D strata thickness. */
  layers: z.array(z.object({ marketId: Hex32, symbol: z.string(), depthUsd25: z.number().nonnegative(), strataDepthUsd25: z.number().nonnegative() })),
  at: TimestampMs,
});
export type HeroStatsResponse = z.infer<typeof HeroStatsResponse>;

/** POST /v1/admin/kill (signed by owner wallet, PRD 9.6 and 16.2) */
export const KillRequest = z.object({
  target: z.union([z.literal("all"), z.number().int().positive()]),
  closePositions: z.boolean(),
  network: NetworkName,
  nonce: z.string().min(16),
  expiresAt: TimestampMs,
  signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
});
export type KillRequest = z.infer<typeof KillRequest>;

/**
 * Canonical EIP-191 (personal_sign) text the owner wallet signs for a KillRequest. Single copy
 * shared by apps/api, services/agent and any client that produces kill requests: field order
 * and labels are part of the protocol, so changing them invalidates every signature.
 */
export function killRequestMessage(req: Omit<KillRequest, "signature">): string {
  return [
    "STRATA kill request",
    `network: ${req.network}`,
    `target: ${req.target}`,
    `closePositions: ${req.closePositions}`,
    `nonce: ${req.nonce}`,
    `expiresAt: ${req.expiresAt}`,
  ].join("\n");
}

/* ---------------------------- WebSocket (ws /v1/stream) ---------------------------- */

export const WsChannel = z.union([
  z.string().regex(/^book:0x[0-9a-fA-F]{64}$/),
  z.string().regex(/^agent:\d+$/),
  z.literal("leaderboard"),
  z.literal("events"),
]);
export type WsChannel = z.infer<typeof WsChannel>;

export const WsClientMessage = z.discriminatedUnion("op", [
  z.object({ op: z.literal("subscribe"), network: NetworkName, channels: z.array(WsChannel).min(1).max(20) }),
  z.object({ op: z.literal("unsubscribe"), network: NetworkName, channels: z.array(WsChannel).min(1).max(20) }),
  z.object({ op: z.literal("ping") }),
]);
export type WsClientMessage = z.infer<typeof WsClientMessage>;

export const WsServerMessage = z.discriminatedUnion("type", [
  z.object({ type: z.literal("book"), channel: z.string(), data: BookSnapshot }),
  z.object({ type: z.literal("agent"), channel: z.string(), data: z.object({ quotes: z.array(Quote), fills: z.array(Fill) }) }),
  z.object({ type: z.literal("leaderboard"), channel: z.literal("leaderboard"), data: z.array(LeaderboardRow) }),
  z.object({ type: z.literal("event"), channel: z.literal("events"), data: z.union([GuardEvent, TunerEvent]) }),
  z.object({ type: z.literal("pong") }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);
export type WsServerMessage = z.infer<typeof WsServerMessage>;

/** Max server pushes per channel per second (PRD 11.3). */
export const WS_MAX_UPDATES_PER_SEC = 4;
