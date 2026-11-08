/**
 * Read-only: recent Cosmos txs signed by each testnet house agent, with memo and height, from the
 * chain REST gateway (`/cosmos/tx/v1beta1/txs`, Cosmos SDK tx service). Used as kill switch
 * evidence (memo `strata:cancel-all`, `strata:close-reduce-only`).
 *   pnpm --filter @strata/agent inj:recent-txs [agent-name ...] [--limit N]
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getEndpointSet } from "../endpoints.js";

const args = process.argv.slice(2).filter((a) => a !== "--");
const li = args.indexOf("--limit");
const limit = li >= 0 ? Number(args[li + 1]) : 8;
const names = args.filter((a, i) => !a.startsWith("--") && (li < 0 || i !== li + 1));
const enrollments = JSON.parse(readFileSync(fileURLToPath(new URL("../../../config/enrollments.testnet.json", import.meta.url)), "utf8")) as Record<string, { injAddress: string }>;
const rest = getEndpointSet("testnet").bundles[0]?.rest;
if (rest === undefined) throw new Error("no testnet REST endpoint");

interface TxResp {
  tx_responses?: { txhash: string; height: string; timestamp: string; code: number; tx: { body: { memo: string } } }[];
}
for (const [name, e] of Object.entries(enrollments)) {
  if (names.length > 0 && !names.includes(name)) continue;
  const url = `${rest}/cosmos/tx/v1beta1/txs?query=${encodeURIComponent(`message.sender='${e.injAddress}'`)}&order_by=ORDER_BY_DESC&limit=${limit}&pagination.limit=${limit}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const body = (await res.json()) as TxResp;
  for (const t of body.tx_responses ?? []) {
    process.stdout.write(`${name} ${t.timestamp} h=${t.height} code=${t.code} memo=${t.tx.body.memo} ${t.txhash}\n`);
  }
}
