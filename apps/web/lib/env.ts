/**
 * Public runtime configuration. Only NEXT_PUBLIC_* values are read here, so nothing secret can
 * reach the browser bundle through this module.
 *
 * Data modes:
 * - live:          NEXT_PUBLIC_STRATA_API is set; every response is validated with the sdk schemas.
 * - mock:          development only, no API configured; deterministic MOCK data with a visible badge.
 * - unconfigured:  production build without an API; views show a designed "data unavailable" state.
 */
export type DataMode = "live" | "mock" | "unconfigured";

function normalizeBase(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/\/+$/, "");
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return trimmed;
  } catch {
    return null;
  }
}

export const API_BASE = normalizeBase(process.env.NEXT_PUBLIC_STRATA_API);
export const IS_PRODUCTION = process.env.NODE_ENV === "production";

export function resolveDataMode(apiBase: string | null, nodeEnv: string | undefined): DataMode {
  if (apiBase) return "live";
  return nodeEnv === "production" ? "unconfigured" : "mock";
}

export const DATA_MODE: DataMode = resolveDataMode(API_BASE, process.env.NODE_ENV);

/** Public site origin for metadata, sitemap and OG URLs. */
export const SITE_URL = normalizeBase(process.env.NEXT_PUBLIC_SITE_URL) ?? "http://localhost:3000";

export function wsUrl(apiBase: string): string {
  const u = new URL(`${apiBase}/v1/stream`);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  return u.toString();
}
