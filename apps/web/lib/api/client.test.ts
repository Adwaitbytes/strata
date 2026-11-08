import { LeaderboardResponse, MockInProductionError, mockLeaderboard } from "@strata/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { StrataApiError, __testing } from "./client";
import { mockAgentDetail, mockEpoch, mockLeaderboardResponse, mockMarketDetail, mockStatus, mockTransparency, MOCK_MARKET_IDS } from "./mock-data";
import { AgentDetailResponse, EpochResponse, MarketDetailResponse, StatusResponse, TransparencyResponse } from "@strata/sdk";

const live = { mode: "live" as const, base: "https://api.test", env: "production" };
const valid = { network: "testnet", season: 0, epoch: 3, seasonEndsAt: null, rows: [], at: 1 };

function stubFetch(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));
}

afterEach(() => vi.unstubAllGlobals());

describe("api client (live)", () => {
  it("returns schema-validated data", async () => {
    stubFetch(200, valid);
    const out = await __testing.request("/v1/leaderboard", LeaderboardResponse, () => null, { source: live });
    expect(out.epoch).toBe(3);
  });

  it("rejects responses that fail the schema", async () => {
    stubFetch(200, { ...valid, rows: "nope" });
    await expect(__testing.request("/v1/leaderboard", LeaderboardResponse, () => null, { source: live })).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("maps API error bodies to typed errors", async () => {
    stubFetch(404, { error: { code: "not_found", message: "no agent" } });
    const err = await __testing.request("/v1/agents/9", LeaderboardResponse, () => null, { source: live }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StrataApiError);
    expect((err as StrataApiError).code).toBe("not_found");
    expect((err as StrataApiError).status).toBe(404);
  });

  it("refuses MOCK provenance from a live API in production", async () => {
    stubFetch(200, { ...valid, rows: mockLeaderboard("testnet", 1) });
    await expect(__testing.request("/v1/leaderboard", LeaderboardResponse, () => null, { source: live })).rejects.toBeInstanceOf(
      MockInProductionError,
    );
  });

  it("reports network failures", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("offline"))));
    await expect(__testing.request("/x", LeaderboardResponse, () => null, { source: live })).rejects.toMatchObject({ code: "network" });
  });

  it("never serves mocks when unconfigured", async () => {
    const mock = vi.fn(() => valid);
    await expect(
      __testing.request("/x", LeaderboardResponse, mock, { source: { mode: "unconfigured", base: null, env: "production" } }),
    ).rejects.toMatchObject({ code: "unconfigured" });
    expect(mock).not.toHaveBeenCalled();
  });

  it("blocks mock mode in production even if misconfigured", async () => {
    await expect(
      __testing.request("/x", LeaderboardResponse, () => valid, { source: { mode: "mock", base: null, env: "production" } }),
    ).rejects.toMatchObject({ code: "unconfigured" });
  });
});

describe("mock data matches the sdk schemas", () => {
  it("leaderboard", () => {
    expect(LeaderboardResponse.safeParse(mockLeaderboardResponse("testnet", 3)).success).toBe(true);
  });
  it("market detail", () => {
    expect(MarketDetailResponse.safeParse(mockMarketDetail("testnet", MOCK_MARKET_IDS[0]!)).success).toBe(true);
  });
  it("agent detail", () => {
    const r = AgentDetailResponse.safeParse(mockAgentDetail("testnet", 1));
    expect(r.success ? null : r.error.issues).toBeNull();
  });
  it("epoch", () => {
    expect(EpochResponse.safeParse(mockEpoch("testnet", 12)).success).toBe(true);
  });
  it("transparency and status", () => {
    expect(TransparencyResponse.safeParse(mockTransparency("testnet")).success).toBe(true);
    expect(StatusResponse.safeParse(mockStatus("testnet")).success).toBe(true);
  });
  it("mainnet is empty, not invented", () => {
    expect(mockLeaderboardResponse("mainnet").rows).toEqual([]);
    expect(mockAgentDetail("mainnet", 1)).toBeNull();
  });
});
