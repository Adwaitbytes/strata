/**
 * Long-running baseline recorder. Env:
 *   DATABASE_URL | DATABASE_URL_FILE   target database (single switch, D26)
 *   BASELINE_NETWORKS                  comma list, default "mainnet,testnet" (read-only public data)
 *   BASELINE_INTERVAL_MS               default 5000 (PRD 10.2)
 *   BASELINE_MAX_MARKETS               optional cap per network (story markets first)
 *   BASELINE_LEVELS_EVERY_MS           full stored depth period, default 60000; top of book otherwise
 *   BASELINE_MAX_LEVELS                levels per side on full-depth samples, default 5
 *
 * Storage: Neon free tier is 0.5 GB (D26), so production runs with a market cap and minute-level
 * stored depth. Spread, depth and mid are computed from the full book on every sample regardless.
 */
import { getMarkets } from "@strata/config";
import { createDb, describeDatabaseUrl, resolveDatabaseUrl } from "@strata/db";
import { NetworkName } from "@strata/sdk";
import { z } from "zod";
import { BaselineRecorder } from "../baseline/recorder.js";
import { indexerEndpoint } from "../injective/endpoints.js";
import { createInjectiveReader } from "../injective/reader.js";
import { errMsg, log } from "../lib/log.js";

const Env = z.object({
  BASELINE_NETWORKS: z.string().default("mainnet,testnet"),
  BASELINE_INTERVAL_MS: z.coerce.number().int().min(1000).default(5000),
  BASELINE_MAX_MARKETS: z.coerce.number().int().positive().optional(),
  BASELINE_LEVELS_EVERY_MS: z.coerce.number().int().min(1000).default(60_000),
  BASELINE_MAX_LEVELS: z.coerce.number().int().min(1).max(50).default(5),
});
const env = Env.parse(process.env);
const networks = z.array(NetworkName).parse(env.BASELINE_NETWORKS.split(",").map((s) => s.trim()).filter(Boolean));

const url = resolveDatabaseUrl();
const { db, close } = createDb(url, { max: 4 });
log("info", "baseline recorder starting", { db: describeDatabaseUrl(url), networks, ...env });

const recorders = networks.map(
  (network) =>
    new BaselineRecorder({
      network,
      reader: createInjectiveReader(network),
      db,
      source: `${indexerEndpoint(network)} IndexerGrpcDerivativesApi.fetchMarkets`,
      configured: getMarkets(network),
      intervalMs: env.BASELINE_INTERVAL_MS,
      levelsEveryMs: env.BASELINE_LEVELS_EVERY_MS,
      maxStoredLevels: env.BASELINE_MAX_LEVELS,
      ...(env.BASELINE_MAX_MARKETS === undefined ? {} : { maxMarkets: env.BASELINE_MAX_MARKETS }),
    }),
);

async function startWithRetry(r: BaselineRecorder, network: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await r.start();
      return;
    } catch (e) {
      const delay = Math.min(60_000, 2000 * 2 ** attempt);
      log("error", "baseline start failed, retrying", { network, error: errMsg(e), delayMs: delay });
      await new Promise((res) => setTimeout(res, delay));
    }
  }
}

await Promise.all(recorders.map((r, i) => startWithRetry(r, networks[i] ?? "?")));

const shutdown = async (signal: string) => {
  log("info", "baseline recorder stopping", { signal });
  for (const r of recorders) r.stop();
  await close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("unhandledRejection", (e) => log("error", "unhandled rejection", { error: errMsg(e) }));
