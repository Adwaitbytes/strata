/**
 * Read-only: prints the open derivative orders on chain for each enrolled testnet house agent's
 * subaccount, per configured market (kill switch evidence, live checks). No keys are loaded.
 *   pnpm --filter @strata/agent inj:open-orders [agent-name ...]
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getMarkets } from "@strata/config";
import { ChainExchange } from "../chain.js";
import { getEndpointSet } from "../endpoints.js";

interface Enrollment {
  subaccountId: string;
  arenaAgentId: number | null;
}
const enrollments = JSON.parse(readFileSync(fileURLToPath(new URL("../../../config/enrollments.testnet.json", import.meta.url)), "utf8")) as Record<string, Enrollment>;
const chain = new ChainExchange(getEndpointSet("testnet"));
const names = process.argv.slice(2).filter((a) => a !== "--");
const at = new Date().toISOString();
let total = 0;
for (const [name, e] of Object.entries(enrollments)) {
  if (names.length > 0 && !names.includes(name)) continue;
  const cfg = JSON.parse(readFileSync(fileURLToPath(new URL(`../../../config/agents/${name}.json`, import.meta.url)), "utf8")) as { markets: { ticker: string }[] };
  for (const { ticker } of cfg.markets) {
    const m = getMarkets("testnet").find((x) => x.ticker === ticker);
    if (m === undefined) continue;
    const orders = await chain.openOrders(m.marketId, e.subaccountId);
    total += orders.length;
    const book = orders.map((o) => `${o.isBuy ? "B" : "S"} ${o.quantity}@${o.price}`).join(", ");
    process.stdout.write(`${at} ${name} agent=${e.arenaAgentId} ${ticker} open=${orders.length}${book ? ` [${book}]` : ""}\n`);
  }
}
process.stdout.write(`${at} total open orders: ${total}\n`);
