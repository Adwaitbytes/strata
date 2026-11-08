/**
 * Writes packages/config/src/generated/markets.<network>.json (and market-sessions.<network>.json)
 * from a LIVE Injective query. Implementation: services/agent/src/injective/markets/fetch-markets.ts.
 *
 *   pnpm fetch-markets                 # both networks
 *   pnpm fetch-markets -- testnet      # one network
 */
import { join } from "node:path";

// tsx runs this file as CommonJS (scripts/ has no package.json), so __dirname is available.
const root = join(__dirname, "..");
const outDir = join(root, "packages/config/src/generated");
const requested = process.argv
  .slice(2)
  .filter((a) => a === "mainnet" || a === "testnet");
const networks =
  requested.length > 0 ? requested : (["mainnet", "testnet"] as const);

async function main(): Promise<boolean> {
  // Dynamic import: the implementation lives in an ESM package (services/agent), this file runs as CJS.
  const { fetchMarkets, writeMarkets } = await import("../services/agent/src/injective/markets/fetch-markets.js");
  let failed = false;
  for (const network of networks) {
    try {
      const result = await fetchMarkets(network);
      const paths = await writeMarkets(result, outDir);
      console.log(
        `[${network}] ${result.markets.length} active perpetual markets -> ${paths.marketsPath}`,
      );
      console.log(
        `[${network}] arena: ${result.arenaTickers.join(", ") || "(none)"}`,
      );
      if (result.missingArenaTickers.length > 0)
        console.log(
          `[${network}] arena candidates not found: ${result.missingArenaTickers.join(", ")}`,
        );
      for (const w of result.warnings)
        console.warn(`[${network}] warning: ${w}`);
    } catch (err) {
      failed = true;
      console.error(
        `[${network}] fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  return !failed;
}

main().then(
  (ok) => process.exit(ok ? 0 : 1),
  (err: unknown) => {
    console.error(err);
    process.exit(1);
  },
);
