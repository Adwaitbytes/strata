/**
 * TESTNET integration test for the Injective adapter. Never runs on mainnet.
 *
 *   pnpm --filter @strata/agent inj:testnet-smoke [-- --key strata-test-1 --ticker "INJ/USDC PERP" --granter inj1...]
 *
 * 1. Loads the key via KeySource, primes the account if it never sent a tx.
 * 2. Deposits a few test USDC into subaccount 0 if the subaccount is empty.
 * 3. Places ONE post-only buy at half the oracle price (far from mid) with MsgBatchUpdateOrdersV2.
 * 4. Verifies the order on the Indexer and on chain, then cancels it in a second batch tx and
 *    verifies it is gone. Prints tx hashes and explorer links only.
 */
import { IndexerGrpcDerivativesApi } from "@injectivelabs/sdk-ts";
import { getMarkets } from "@strata/config";
import { KeystoreKeySource } from "@strata/keys";
import { createInjectiveAdapter } from "../adapter.js";
import type { InjectiveAdapter } from "../adapter.js";
import { getEndpointSet } from "../endpoints.js";
import { sleep } from "../retry.js";
import { dec, plain, quantize } from "../units.js";

const EXPLORER = "https://testnet.explorer.injective.network/transaction/";

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] ?? fallback) : fallback;
}

async function indexerHasOrder(adapter: InjectiveAdapter, marketId: string, orderHash: string): Promise<boolean> {
  const e = getEndpointSet("testnet").bundles[0];
  if (e === undefined) throw new Error("no endpoints");
  const { orders } = await new IndexerGrpcDerivativesApi(e.indexer).fetchOrders({ marketId, subaccountId: adapter.subaccountId });
  return orders.some((o) => o.orderHash.toLowerCase() === orderHash.toLowerCase());
}

async function waitFor(label: string, check: () => Promise<boolean>, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) {
      console.log(`  verified: ${label}`);
      return;
    }
    await sleep(1_500);
  }
  throw new Error(`timed out: ${label}`);
}

async function main(): Promise<void> {
  const keyName = arg("key", "strata-test-1");
  const ticker = arg("ticker", "INJ/USDC PERP");
  const market = getMarkets("testnet").find((m) => m.ticker === ticker);
  if (market === undefined) throw new Error(`${ticker} not in generated testnet markets`);

  const adapter = await createInjectiveAdapter({
    network: "testnet",
    keySource: new KeystoreKeySource(),
    keyName,
    subaccountIndex: 0,
    marketIds: [market.marketId],
    streams: false,
    ...(arg("granter", "") === "" ? {} : { granter: arg("granter", "") }),
  });
  if (adapter.isAuthz) console.log(`authz mode: signer ${adapter.signerAddress} trades for ${adapter.address}`);
  console.log(`wallet ${adapter.address} subaccount ${adapter.subaccountId}`);
  console.log(`market ${market.ticker} ${market.marketId}`);

  const prime = adapter.isAuthz ? null : await adapter.primeAccountIfNeeded();
  if (prime !== null) console.log(`primed account with EVM tx ${prime}`);

  let available = await adapter.availableQuote(market);
  console.log(`subaccount available quote (raw read): ${available}`);
  if (!adapter.isDefaultSubaccount && dec(available).lt(2)) {
    const dep = await adapter.depositToSubaccount("5", market.quoteDenom, market.quoteDecimals);
    console.log(`deposit 5 USDC -> subaccount tx ${dep.txHash} ${EXPLORER}${dep.txHash}`);
    await waitFor("deposit visible", async () => dec(await adapter.availableQuote(market)).gte(2));
    available = await adapter.availableQuote(market);
  }

  const state = await adapter.getMarketState(market.marketId);
  const bestBid = state.bids[0]?.price ?? "none";
  const bestAsk = state.asks[0]?.price ?? "none";
  const ageSec = Math.round((state.chainTimeMs - state.oracle.timestampMs) / 1000);
  console.log(`state: available ${available} USDC, bid ${bestBid} ask ${bestAsk}, oracle ${state.oracle.price} (age ${ageSec}s), mark ${state.markPrice}`);

    // Far from both the oracle and the resting book: the lower of half the oracle and half the best bid.
  const anchor = state.bids[0] === undefined ? dec(state.oracle.price) : dec(state.oracle.price).lt(state.bids[0].price) ? dec(state.oracle.price) : dec(state.bids[0].price);
  const price = quantize(plain(anchor.div(2)), market.minPriceTickSize, "down");
  const qty = quantize(plain(dec(market.minNotional).mul("1.5").div(price)), market.minQuantityTickSize, "up");
  const cid = `strata-smoke-${Date.now()}`;
  const placed = await adapter.batchUpdate({
    marketId: market.marketId,
    cancelOrderHashes: [],
    create: [{ side: "buy", price, quantity: qty, postOnly: true, reduceOnly: false, cid }],
    feeRecipient: adapter.signerAddress,
  });
  console.log(`place post-only buy ${qty} @ ${price}: tx ${placed.txHash} ${EXPLORER}${placed.txHash}`);
  if (placed.rejected.length > 0) throw new Error(`rejected: ${JSON.stringify(placed.rejected)}`);
  const hash = placed.createdOrderHashes[0];
  if (hash === undefined) throw new Error("no order hash returned");
  console.log(`  order hash ${hash}`);
  await waitFor("order on chain", async () => (await adapter.getOpenOrders(market.marketId)).some((o) => o.orderHash === hash));
  await waitFor("order on Indexer", () => indexerHasOrder(adapter, market.marketId, hash));

  const cancelled = await adapter.batchUpdate({ marketId: market.marketId, cancelOrderHashes: [hash], create: [], feeRecipient: adapter.signerAddress });
  console.log(`cancel: tx ${cancelled.txHash} ${EXPLORER}${cancelled.txHash}`);
  await waitFor("order gone on chain", async () => !(await adapter.getOpenOrders(market.marketId)).some((o) => o.orderHash === hash));
  await waitFor("order gone on Indexer", async () => !(await indexerHasOrder(adapter, market.marketId, hash)));

  await adapter.cancelAll(market.marketId);
  console.log("cancelAll on an empty book: ok (idempotent)");
  adapter.close();
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    console.error(`smoke failed: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  },
);
