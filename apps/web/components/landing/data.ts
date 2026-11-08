import "server-only";
import { HeroStatsResponse, MarketsResponse, type NetworkName } from "@strata/sdk";
import type { z } from "zod";
import { API_BASE } from "@/lib/env";

/**
 * Landing data access. Every call resolves to a tagged result instead of throwing, so the
 * page always renders: an unreachable or invalid API becomes an explicit "not live" state,
 * never a guessed number.
 */

export type Loaded<T> = { status: "ok"; data: T } | { status: "unavailable"; reason: string };

const REVALIDATE_SECONDS = 30;
const TIMEOUT_MS = 2500;

/** Network the public landing reports on. Testnet until mainnet is funded (D27). */
export function landingNetwork(): NetworkName {
  return process.env.NEXT_PUBLIC_STRATA_NETWORK === "mainnet" ? "mainnet" : "testnet";
}


async function getJson<S extends z.ZodTypeAny>(path: string, schema: S): Promise<Loaded<z.infer<S>>> {
  const base = API_BASE;
  if (!base) return { status: "unavailable", reason: "API endpoint not configured" };
  try {
    const res = await fetch(`${base}${path}`, {
      next: { revalidate: REVALIDATE_SECONDS },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    if (!res.ok) return { status: "unavailable", reason: `API responded ${res.status}` };
    const parsed = schema.safeParse(await res.json());
    if (!parsed.success) return { status: "unavailable", reason: "API response failed validation" };
    return { status: "ok", data: parsed.data };
  } catch (err) {
    const reason = err instanceof Error && err.name === "TimeoutError" ? "API timed out" : "API unreachable";
    return { status: "unavailable", reason };
  }
}

/** MOCK data is for local development only and never reaches a production view. */
function rejectMock<T extends { provenance: string }>(result: Loaded<T>): Loaded<T> {
  if (result.status === "ok" && result.data.provenance === "MOCK" && process.env.NODE_ENV === "production") {
    return { status: "unavailable", reason: "Only mock data is available" };
  }
  return result;
}

export async function getHeroStats(network: NetworkName): Promise<Loaded<HeroStatsResponse>> {
  return rejectMock(await getJson(`/v1/stats?network=${network}`, HeroStatsResponse));
}

export async function getMarkets(network: NetworkName): Promise<Loaded<MarketsResponse>> {
  const result = await getJson(`/v1/markets?network=${network}`, MarketsResponse);
  if (result.status !== "ok" || process.env.NODE_ENV !== "production") return result;
  const markets = result.data.markets.map((m) => (m.now?.provenance === "MOCK" ? { ...m, now: null } : m));
  return { status: "ok", data: { ...result.data, markets } };
}
