/**
 * One table drives both the Fastify routes and the OpenAPI document, so the published
 * spec cannot drift from what the server validates.
 */
import { z, type AnyZodObject, type ZodTypeAny } from "zod";
import {
  AgentDetailResponse,
  AgentsResponse,
  EpochListResponse,
  EpochResponse,
  Hex32,
  HeroStatsResponse,
  LeaderboardResponse,
  MarketDetailResponse,
  MarketsResponse,
  NetworkQuery,
  StatusResponse,
  TransparencyResponse,
} from "@strata/sdk";
import type { ReadContext } from "../services/read.js";
import * as read from "../services/read.js";

const NoParams = z.object({});
export const MarketParams = z.object({ id: Hex32 });
export const AgentParams = z.object({ id: z.coerce.number().int().positive().max(2 ** 31 - 1) });
export const EpochParams = z.object({
  season: z.coerce.number().int().nonnegative().max(2 ** 31 - 1),
  epoch: z.coerce.number().int().nonnegative().max(2 ** 31 - 1),
});
export const LeaderboardQuery = NetworkQuery.extend({ season: z.coerce.number().int().nonnegative().max(2 ** 31 - 1).optional() });

export interface RouteSpec<Q extends AnyZodObject, P extends AnyZodObject, R extends ZodTypeAny> {
  /** Fastify path (":param"). */
  path: string;
  summary: string;
  tag: string;
  query: Q;
  params: P;
  response: R;
  handler: (ctx: ReadContext, query: z.infer<Q>, params: z.infer<P>) => Promise<z.infer<R>>;
}

/** Identity helper so each table entry infers its own generic types. */
function route<Q extends AnyZodObject, P extends AnyZodObject, R extends ZodTypeAny>(spec: RouteSpec<Q, P, R>): RouteSpec<Q, P, R> {
  return spec;
}

export const PUBLIC_ROUTES = [
  route({
    path: "/v1/markets", summary: "Arena markets with spread and depth now vs baseline", tag: "markets",
    query: NetworkQuery, params: NoParams, response: MarketsResponse,
    handler: (ctx, q) => read.getMarkets(ctx, q.network),
  }),
  route({
    path: "/v1/markets/:id", summary: "One market: book, 24h history, oracle health", tag: "markets",
    query: NetworkQuery, params: MarketParams, response: MarketDetailResponse,
    handler: (ctx, q, p) => read.getMarketDetail(ctx, q.network, p.id),
  }),
  route({
    path: "/v1/agents", summary: "Enrolled agents", tag: "agents",
    query: NetworkQuery, params: NoParams, response: AgentsResponse,
    handler: (ctx, q) => read.getAgents(ctx, q.network),
  }),
  route({
    path: "/v1/agents/:id", summary: "Agent profile, live quotes, fills, scores, guard and tuner feed", tag: "agents",
    query: NetworkQuery, params: AgentParams, response: AgentDetailResponse,
    handler: (ctx, q, p) => read.getAgentDetail(ctx, q.network, p.id),
  }),
  route({
    path: "/v1/leaderboard", summary: "Season leaderboard ranked by the latest scored epoch", tag: "scores",
    query: LeaderboardQuery, params: NoParams, response: LeaderboardResponse,
    handler: (ctx, q) => read.getLeaderboard(ctx, q.network, q.season),
  }),
  route({
    path: "/v1/epochs", summary: "Latest epoch attestations", tag: "scores",
    query: NetworkQuery, params: NoParams, response: EpochListResponse,
    handler: (ctx, q) => read.getEpochs(ctx, q.network),
  }),
  route({
    path: "/v1/epochs/:season/:epoch", summary: "Full scoring JSON with merkle proof per agent", tag: "scores",
    query: NetworkQuery, params: EpochParams, response: EpochResponse,
    handler: (ctx, q, p) => read.getEpoch(ctx, q.network, p.season, p.epoch),
  }),
  route({
    path: "/v1/transparency", summary: "Contracts, house agents, limits, guard events, suspensions", tag: "transparency",
    query: NetworkQuery, params: NoParams, response: TransparencyResponse,
    handler: (ctx, q) => read.getTransparency(ctx, q.network),
  }),
  route({
    path: "/v1/status", summary: "Service health, last block seen, data lag", tag: "status",
    query: NetworkQuery, params: NoParams, response: StatusResponse,
    handler: (ctx, q) => read.getStatus(ctx, q.network),
  }),
  route({
    path: "/v1/stats", summary: "Landing hero strip with per-market depth layers", tag: "status",
    query: NetworkQuery, params: NoParams, response: HeroStatsResponse,
    handler: (ctx, q) => read.getHeroStats(ctx, q.network),
  }),
] as const;

