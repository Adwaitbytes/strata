/**
 * Read-only stream health check. Opens the adapter streams for the testnet arena markets for
 * N seconds, then prints stream health and one market state. No transactions.
 *
 *   pnpm --filter @strata/agent exec tsx src/injective/bin/stream-check.ts [seconds]
 */
import { getMarkets } from "@strata/config";
import { KeystoreKeySource } from "@strata/keys";
import { createInjectiveAdapter } from "../adapter.js";
import { sleep } from "../retry.js";

async function main(): Promise<void> {
  const seconds = Number(process.argv[2] ?? "15");
  const markets = getMarkets("testnet").filter((m) => m.arenaEnabled);
  const adapter = await createInjectiveAdapter({
    network: "testnet",
    keySource: new KeystoreKeySource(),
    keyName: "strata-test-1",
    marketIds: markets.map((m) => m.marketId),
    log: (e) => {
      if (e.kind !== "tx") console.log(`[${e.kind}] ${e.detail} ${JSON.stringify(e.data ?? {})}`);
    },
  });
  await sleep(seconds * 1000);
  for (const h of adapter.streamHealth()) {
    const age = h.lastMessageAtMs === null ? "never" : `${Math.round((Date.now() - h.lastMessageAtMs) / 1000)}s ago`;
    console.log(`stream ${h.name}: connected=${h.connected} last=${age} reconnects=${h.reconnects}`);
  }
  for (const m of markets) {
    const s = await adapter.getMarketState(m.marketId);
    const oracleAge = Math.round((s.chainTimeMs - s.oracle.timestampMs) / 1000);
    console.log(`${m.ticker}: bid ${s.bids[0]?.price ?? "-"} ask ${s.asks[0]?.price ?? "-"} oracle ${s.oracle.price} (age ${oracleAge}s) mark ${s.markPrice} funding ${s.fundingRate ?? "-"}`);
  }
  adapter.close();
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    console.error(`stream check failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  },
);
