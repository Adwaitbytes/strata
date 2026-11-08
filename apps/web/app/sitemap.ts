import type { MetadataRoute } from "next";
import { DOCS_NAV } from "@/components/docs/nav";
import { api } from "@/lib/api/client";
import { DATA_MODE, SITE_URL } from "@/lib/env";

const STATIC = ["/", "/arena", "/join", "/transparency", "/status", "/terms", "/risk"];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const pages = [...STATIC, ...DOCS_NAV.map((d) => d.href)].map((p) => ({ url: `${SITE_URL}${p === "/" ? "" : p}`, lastModified: now }));
  // Only live data produces agent and market URLs; mock IDs never enter the sitemap.
  if (DATA_MODE !== "live") return pages;
  const [agents, markets] = await Promise.all([api.agents("testnet").catch(() => null), api.markets("testnet").catch(() => null)]);
  return [
    ...pages,
    ...(agents?.agents ?? []).map((a) => ({ url: `${SITE_URL}/agents/${a.agentId}`, lastModified: now })),
    ...(markets?.markets ?? []).map((m) => ({ url: `${SITE_URL}/markets/${m.market.marketId}`, lastModified: now })),
  ];
}
