/** StreamSource backed by the same read models as REST, so pushes and GETs agree. */
import type { NetworkName } from "@strata/sdk";
import { getLeaderboard, visible, type ReadContext } from "../services/read.js";
import type { StreamSource } from "./hub.js";

const AGENT_FILLS = 20;
const EVENT_BATCH = 100;

export function streamSource(ctx: ReadContext): StreamSource {
  return {
    async book(network: NetworkName, marketId: string) {
      const b = await ctx.repo.latestBook(network, marketId);
      return b && visible(ctx, [b]).length === 1 ? b : null;
    },
    async agent(network: NetworkName, agentId: number) {
      const [quotes, fills] = await Promise.all([
        ctx.repo.liveQuotes(network, agentId, ctx.now() - ctx.freshMs),
        ctx.repo.recentFills(network, agentId, AGENT_FILLS),
      ]);
      return { quotes: visible(ctx, quotes), fills: visible(ctx, fills) };
    },
    async leaderboard(network: NetworkName) {
      return (await getLeaderboard(ctx, network, undefined)).rows;
    },
    async eventsSince(network: NetworkName, sinceMs: number) {
      const [guards, tuners] = await Promise.all([
        ctx.repo.guardEvents(network, { sinceMs, limit: EVENT_BATCH }),
        ctx.repo.tunerEvents(network, { sinceMs, limit: EVENT_BATCH }),
      ]);
      return [...visible(ctx, guards), ...tuners];
    },
  };
}
