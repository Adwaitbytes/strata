/**
 * Typed client for the STRATA REST API (PRD 11.2). Every response is validated with the sdk zod
 * schema for that route and checked against the MOCK-in-production rule before a component sees it.
 */
import {
  AgentDetailResponse,
  AgentsResponse,
  ApiError,
  EpochResponse,
  LeaderboardResponse,
  MarketDetailResponse,
  MarketsResponse,
  StatusResponse,
  TransparencyResponse,
  type NetworkName,
} from "@strata/sdk";
import type { z } from "zod";
import { API_BASE, DATA_MODE, type DataMode } from "@/lib/env";
import { assertNoMockDeep } from "./provenance";

export type StrataErrorCode =
  | z.infer<typeof ApiError>["error"]["code"]
  | "network"
  | "invalid_response"
  | "unconfigured";

export class StrataApiError extends Error {
  constructor(
    readonly code: StrataErrorCode,
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "StrataApiError";
  }
}

export function describeError(err: unknown): { title: string; detail: string } {
  if (err instanceof StrataApiError) {
    switch (err.code) {
      case "not_found":
        return { title: "Not found", detail: "Nothing exists at this ID on the selected network." };
      case "rate_limited":
        return { title: "Too many requests", detail: "The API is rate limiting this browser. Retrying shortly." };
      case "unconfigured":
        return { title: "Data API not connected", detail: "This deployment has no STRATA API configured, so there is nothing to show yet." };
      case "invalid_response":
        return { title: "Unexpected data", detail: "The API returned data that failed validation, so it is not shown." };
      case "network":
        return { title: "Cannot reach the API", detail: "Check your connection. The request will be retried." };
      default:
        return { title: "The API returned an error", detail: err.message };
    }
  }
  return { title: "Something went wrong", detail: err instanceof Error ? err.message : "Unknown error" };
}

interface Source {
  mode: DataMode;
  base: string | null;
  env: string | undefined;
}

const defaultSource: Source = { mode: DATA_MODE, base: API_BASE, env: process.env.NODE_ENV };

async function request<S extends z.ZodTypeAny>(
  path: string,
  schema: S,
  mock: () => unknown,
  { signal, source = defaultSource }: { signal?: AbortSignal | undefined; source?: Source } = {},
): Promise<z.infer<S>> {
  let payload: unknown;
  if (source.mode === "mock") {
    if (source.env === "production") throw new StrataApiError("unconfigured", "Mock data is disabled in production");
    payload = mock();
    if (payload == null) throw new StrataApiError("not_found", "Not found", 404);
  } else if (source.mode === "unconfigured" || !source.base) {
    throw new StrataApiError("unconfigured", "NEXT_PUBLIC_STRATA_API is not set");
  } else {
    let res: Response;
    try {
      res = await fetch(`${source.base}${path}`, { signal: signal ?? null, headers: { accept: "application/json" } });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") throw err;
      throw new StrataApiError("network", err instanceof Error ? err.message : "Network error");
    }
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const parsed = ApiError.safeParse(body);
      if (parsed.success) throw new StrataApiError(parsed.data.error.code, parsed.data.error.message, res.status);
      throw new StrataApiError(res.status === 404 ? "not_found" : "internal", `HTTP ${res.status}`, res.status);
    }
    payload = body;
  }
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new StrataApiError("invalid_response", `Response for ${path} failed validation: ${parsed.error.issues[0]?.message ?? "unknown"}`);
  }
  assertNoMockDeep(parsed.data, source.env);
  return parsed.data;
}

/** Mock data is loaded lazily so production bundles never include it. */
const mocks = () => import("./mock-data");

const q = (params: Record<string, string | number | undefined>) => {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined) sp.set(k, String(v));
  return sp.toString();
};

type Opts = { signal?: AbortSignal | undefined; tick?: number };

async function withMock<T>(load: (m: Awaited<ReturnType<typeof mocks>>) => T): Promise<() => T> {
  if (DATA_MODE !== "mock") return () => null as T;
  const m = await mocks();
  return () => load(m);
}

export const api = {
  async leaderboard(network: NetworkName, opts: Opts & { season?: number } = {}) {
    const mock = await withMock((m) => m.mockLeaderboardResponse(network, opts.tick ?? 0));
    return request(`/v1/leaderboard?${q({ network, season: opts.season })}`, LeaderboardResponse, mock, opts);
  },
  async markets(network: NetworkName, opts: Opts = {}) {
    const mock = await withMock((m) => m.mockMarketsResponse(network));
    return request(`/v1/markets?${q({ network })}`, MarketsResponse, mock, opts);
  },
  async market(network: NetworkName, id: string, opts: Opts = {}) {
    const mock = await withMock((m) => m.mockMarketDetail(network, id, opts.tick ?? 0));
    return request(`/v1/markets/${encodeURIComponent(id)}?${q({ network })}`, MarketDetailResponse, mock, opts);
  },
  async agents(network: NetworkName, opts: Opts = {}) {
    const mock = await withMock((m) => m.mockAgentsResponse(network));
    return request(`/v1/agents?${q({ network })}`, AgentsResponse, mock, opts);
  },
  async agent(network: NetworkName, id: number, opts: Opts = {}) {
    const mock = await withMock((m) => m.mockAgentDetail(network, id, opts.tick ?? 0));
    return request(`/v1/agents/${id}?${q({ network })}`, AgentDetailResponse, mock, opts);
  },
  async epoch(network: NetworkName, season: number, epoch: number, opts: Opts = {}) {
    const mock = await withMock((m) => m.mockEpoch(network, epoch));
    return request(`/v1/epochs/${season}/${epoch}?${q({ network })}`, EpochResponse, mock, opts);
  },
  async transparency(network: NetworkName, opts: Opts = {}) {
    const mock = await withMock((m) => m.mockTransparency(network));
    return request(`/v1/transparency?${q({ network })}`, TransparencyResponse, mock, opts);
  },
  async status(network: NetworkName, opts: Opts = {}) {
    const mock = await withMock((m) => m.mockStatus(network));
    return request(`/v1/status?${q({ network })}`, StatusResponse, mock, opts);
  },
};

/** Exposed for tests: run a request against an explicit source. */
export const __testing = { request };
