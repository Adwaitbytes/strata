import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  AgentDetailResponse,
  AgentsResponse,
  ApiError,
  EpochListResponse,
  EpochResponse,
  HeroStatsResponse,
  LeaderboardResponse,
  MarketDetailResponse,
  MarketsResponse,
  StatusResponse,
  TransparencyResponse,
} from "@strata/sdk";
import { buildApp } from "../src/create-app.js";
import { DataUnavailableError } from "../src/errors.js";
import { MemoryRepo } from "./support/memory-repo.js";
import { testConfig } from "./support/config.js";
import {
  MARKET_A,
  MARKET_B,
  NOW,
  agent,
  attestation,
  book,
  guardEvent,
  market,
  quote,
  score,
  tunerEvent,
} from "./support/fixtures.js";

let repo: MemoryRepo;
let app: FastifyInstance;

beforeEach(async () => {
  repo = new MemoryRepo();
  app = await buildApp({ config: testConfig(), repo, now: () => NOW });
});
afterEach(async () => {
  await app.close();
});

const get = (url: string) => app.inject({ method: "GET", url });

describe("empty database is reported honestly", () => {
  it("GET /v1/markets returns an empty list", async () => {
    const res = await get("/v1/markets?network=testnet");
    expect(res.statusCode).toBe(200);
    const body = MarketsResponse.parse(res.json());
    expect(body).toEqual({ network: "testnet", markets: [], at: NOW });
  });

  it("GET /v1/stats returns zero counts and null improvement, never invented values", async () => {
    const body = HeroStatsResponse.parse((await get("/v1/stats?network=testnet")).json());
    expect(body.agentsLive).toBe(0);
    expect(body.marketsCovered).toBe(0);
    expect(body.strataDepthUsd25).toBe(0);
    expect(body.spreadImprovementBps).toBeNull();
    expect(body.layers).toEqual([]);
    expect(body.provenance).toBe("TESTNET");
  });

  it("GET /v1/leaderboard returns season 0 with no rows", async () => {
    const body = LeaderboardResponse.parse((await get("/v1/leaderboard?network=testnet")).json());
    expect(body).toMatchObject({ season: 0, epoch: null, rows: [], seasonEndsAt: null });
  });

  it("GET /v1/status reports database ok and null lag", async () => {
    const body = StatusResponse.parse((await get("/v1/status?network=testnet")).json());
    expect(body.lastBlockHeight).toBeNull();
    expect(body.dataLagSec).toBeNull();
    expect(body.lastEpochPosted).toBeNull();
    expect(body.services.find((s) => s.name === "database")?.ok).toBe(true);
  });

  it("GET /v1/transparency has null contracts until deployment", async () => {
    // Mainnet has no contracts in packages/config (testnet first, D33).
    const body = TransparencyResponse.parse((await get("/v1/transparency?network=mainnet")).json());
    expect(body.contracts).toEqual({ arena: null, attestor: null, rewards: null });
    expect(body.houseAgents).toEqual([]);
  });

  it("GET /v1/epochs returns an empty list", async () => {
    const body = EpochListResponse.parse((await get("/v1/epochs?network=testnet")).json());
    expect(body.epochs).toEqual([]);
  });

  it("GET /v1/agents returns an empty list", async () => {
    const body = AgentsResponse.parse((await get("/v1/agents?network=testnet")).json());
    expect(body.agents).toEqual([]);
  });
});

describe("markets", () => {
  beforeEach(() => {
    repo.data.markets = [market(MARKET_A, "AAA/USDT"), market(MARKET_B, "BBB/USDT")];
    repo.data.books = [book(MARKET_A), book(MARKET_B, NOW - 10 * 60_000)];
    repo.data.baselines = [{ network: "testnet", marketId: MARKET_A, spreadBps: 30, depthUsd25: 1000, windowStart: NOW - 86_400_000, windowEnd: NOW - 43_200_000, samples: 8640 }];
    repo.data.oracles = [{ network: "testnet", marketId: MARKET_A, price: "100.02", timestamp: NOW - 5_000 }];
    repo.data.history = [{ network: "testnet", marketId: MARKET_A, at: NOW - 60_000, spreadBps: 21, depthUsd25: 2100, strataDepthUsd25: 800, provenance: "TESTNET" }];
  });

  it("summarises fresh books and nulls stale ones", async () => {
    const body = MarketsResponse.parse((await get("/v1/markets?network=testnet")).json());
    const a = body.markets.find((m) => m.market.marketId === MARKET_A);
    const b = body.markets.find((m) => m.market.marketId === MARKET_B);
    expect(a?.now).toMatchObject({ spreadBps: 20, depthUsd25: 2200, strataDepthUsd25: 900, provenance: "TESTNET", sessionState: "open" });
    expect(a?.now?.strataBookShare).toBeCloseTo(900 / 2200);
    expect(a?.baseline).toMatchObject({ spreadBps: 30, samples: 8640 });
    expect(b?.now).toBeNull();
    expect(b?.baseline).toBeNull();
  });

  it("returns market detail with book, history and oracle health", async () => {
    const res = await get(`/v1/markets/${MARKET_A}?network=testnet`);
    expect(res.statusCode).toBe(200);
    const body = MarketDetailResponse.parse(res.json());
    expect(body.book?.marketId).toBe(MARKET_A);
    expect(body.history).toHaveLength(1);
    expect(body.oracle).toEqual({ price: "100.02", timestamp: NOW - 5_000, ageSec: 5, healthy: true });
  });

  it("marks oracle unhealthy when missing", async () => {
    const body = MarketDetailResponse.parse((await get(`/v1/markets/${MARKET_B}?network=testnet`)).json());
    expect(body.oracle).toEqual({ price: null, timestamp: null, ageSec: null, healthy: false });
  });

  it("404s an unknown market with the ApiError shape", async () => {
    const res = await get(`/v1/markets/0x${"0".repeat(64)}?network=testnet`);
    expect(res.statusCode).toBe(404);
    expect(ApiError.parse(res.json()).error.code).toBe("not_found");
  });

  it("400s a malformed market id", async () => {
    const res = await get(`/v1/markets/not-a-market?network=testnet`);
    expect(res.statusCode).toBe(400);
    expect(ApiError.parse(res.json()).error.code).toBe("bad_request");
  });

  it("computes hero stats with per-market layers from fresh books only", async () => {
    repo.data.agents = [agent(1)];
    repo.data.quotes = [quote(1)];
    const body = HeroStatsResponse.parse((await get("/v1/stats?network=testnet")).json());
    expect(body.marketsCovered).toBe(1);
    expect(body.agentsLive).toBe(1);
    expect(body.strataDepthUsd25).toBe(900);
    expect(body.spreadImprovementBps).toBe(10);
    expect(body.layers).toEqual([{ marketId: MARKET_A, symbol: "AAA/USDT", depthUsd25: 2200, strataDepthUsd25: 900 }]);
  });

  it("labels hero stats with the weakest provenance present", async () => {
    repo.data.books = [book(MARKET_A, NOW - 1_000, { provenance: "SIMULATED" })];
    const body = HeroStatsResponse.parse((await get("/v1/stats?network=testnet")).json());
    expect(body.provenance).toBe("SIMULATED");
  });
});

describe("network parameter", () => {
  it("rejects an unknown network", async () => {
    const res = await get("/v1/markets?network=devnet");
    expect(res.statusCode).toBe(400);
    expect(ApiError.parse(res.json()).error.code).toBe("bad_request");
  });

  it("defaults to mainnet", async () => {
    const body = MarketsResponse.parse((await get("/v1/markets")).json());
    expect(body.network).toBe("mainnet");
  });
});

describe("agents", () => {
  beforeEach(() => {
    repo.data.agents = [agent(1), agent(2, { kind: "third_party", name: "ext" })];
    repo.data.quotes = [quote(1), quote(1, NOW - 10 * 60_000)];
    repo.data.scores = [score(1, 2, 8000)];
    repo.data.guardEvents = [guardEvent()];
    repo.data.tunerEvents = [tunerEvent()];
    repo.data.heartbeats = [{ network: "testnet", service: "agent:1", at: NOW - 1_000, detail: { limits: { maxGrossNotionalUsd: 500, nested: { x: 1 } }, capitalUsd: 250 } }];
  });

  it("lists agents", async () => {
    const body = AgentsResponse.parse((await get("/v1/agents?network=testnet")).json());
    expect(body.agents.map((a) => a.agentId)).toEqual([1, 2]);
  });

  it("returns agent detail with only recent live quotes and scalar limits", async () => {
    const body = AgentDetailResponse.parse((await get("/v1/agents/1?network=testnet")).json());
    expect(body.liveQuotes).toHaveLength(1);
    expect(body.scores).toHaveLength(1);
    expect(body.guardEvents).toHaveLength(1);
    expect(body.tunerEvents).toHaveLength(1);
    expect(body.limits).toEqual({ maxGrossNotionalUsd: 500 });
  });

  it("404s an unknown agent and 400s a non-numeric id", async () => {
    expect((await get("/v1/agents/99?network=testnet")).statusCode).toBe(404);
    expect((await get("/v1/agents/abc?network=testnet")).statusCode).toBe(400);
  });

  it("lists house agents with reported capital on the transparency page", async () => {
    const body = TransparencyResponse.parse((await get("/v1/transparency?network=testnet")).json());
    expect(body.houseAgents).toEqual([{ agentId: 1, name: "house-1", injAddress: agent(1).injAddress, capitalUsd: 250, limits: { maxGrossNotionalUsd: 500 } }]);
    expect(body.guardEvents).toHaveLength(1);
  });
});

describe("leaderboard and epochs", () => {
  beforeEach(() => {
    repo.data.agents = [agent(1), agent(2), agent(3)];
    repo.data.scores = [score(1, 4, 7000), score(2, 4, 9000), score(1, 3, 9000), score(2, 3, 6000), score(3, 4, 7000)];
    repo.data.epochs = [attestation(0, 4), attestation(0, 3)];
  });

  it("ranks the latest epoch and carries the previous rank", async () => {
    const body = LeaderboardResponse.parse((await get("/v1/leaderboard?network=testnet")).json());
    expect(body.epoch).toBe(4);
    expect(body.rows.map((r) => [r.agentId, r.rank, r.previousRank])).toEqual([[2, 1, 2], [1, 2, 1], [3, 3, null]]);
  });

  it("reports the onchain season end from the SeasonStarted event", async () => {
    repo.data.seasonEnds = [{ network: "testnet", season: 0, endsAtMs: 1_796_860_800_000 }];
    const body = LeaderboardResponse.parse((await get("/v1/leaderboard?network=testnet")).json());
    expect(body.seasonEndsAt).toBe(1_796_860_800_000);
  });

  it("leaves the season end null when no SeasonStarted event is indexed", async () => {
    const body = LeaderboardResponse.parse((await get("/v1/leaderboard?network=testnet")).json());
    expect(body.seasonEndsAt).toBeNull();
  });

  it("returns 200 with no rows for a season without scores", async () => {
    const body = LeaderboardResponse.parse((await get("/v1/leaderboard?network=testnet&season=5")).json());
    expect(body).toMatchObject({ season: 5, rows: [], epoch: null });
  });

  it("returns an epoch with scores", async () => {
    const body = EpochResponse.parse((await get("/v1/epochs/0/4?network=testnet")).json());
    expect(body.attestation.epoch).toBe(4);
    expect(body.scores).toHaveLength(3);
  });

  it("404s a missing epoch", async () => {
    expect((await get("/v1/epochs/0/99?network=testnet")).statusCode).toBe(404);
  });
});

describe("failure handling", () => {
  it("returns a generic 503 when the database fails, without leaking internals", async () => {
    repo.failWith = new DataUnavailableError({ cause: new Error("connect ECONNREFUSED 10.0.0.5:5432 password=hunter2") });
    const res = await get("/v1/markets?network=testnet");
    expect(res.statusCode).toBe(503);
    const body = ApiError.parse(res.json());
    expect(body.error.code).toBe("unavailable");
    expect(res.body).not.toContain("hunter2");
    expect(res.body).not.toContain("ECONNREFUSED");
  });

  it("returns the ApiError shape for unknown routes", async () => {
    const res = await get("/v1/nope");
    expect(res.statusCode).toBe(404);
    expect(ApiError.parse(res.json()).error.code).toBe("not_found");
  });

  it("refuses to send a payload that violates the response schema", async () => {
    repo.data.agents = [{ ...agent(1), name: "" }];
    const res = await get("/v1/agents?network=testnet");
    expect(res.statusCode).toBe(500);
    expect(ApiError.parse(res.json()).error.code).toBe("internal");
  });

  it("drops MOCK rows when mocks are not allowed", async () => {
    repo.data.markets = [market()];
    repo.data.books = [book(MARKET_A, NOW - 1_000, { provenance: "MOCK" })];
    const body = MarketsResponse.parse((await get("/v1/markets?network=testnet")).json());
    expect(body.markets[0]?.now).toBeNull();
  });
});

describe("agent metadataURI (L-8)", () => {
  it.each(["javascript:alert(1)", "data:text/html,<script>x</script>", "http://plain.example/meta.json", "JAVASCRIPT:alert(1)", " https://x"])(
    "blanks unsafe scheme %s",
    async (uri) => {
      repo.data.agents = [agent(1, { metadataURI: uri })];
      const list = AgentsResponse.parse((await get("/v1/agents?network=testnet")).json());
      expect(list.agents[0]?.metadataURI).toBe("");
      const detail = AgentDetailResponse.parse((await get("/v1/agents/1?network=testnet")).json());
      expect(detail.agent.metadataURI).toBe("");
    },
  );

  it.each(["https://strata.example/agent.json", "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi", ""])("keeps %s", async (uri) => {
    repo.data.agents = [agent(1, { metadataURI: uri })];
    const list = AgentsResponse.parse((await get("/v1/agents?network=testnet")).json());
    expect(list.agents[0]?.metadataURI).toBe(uri);
  });
});
