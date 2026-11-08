# Injective integration facts (W3)

Every fact below was verified on 2026-11-09 from an official source or a live query. Anything we
could not verify is marked **UNVERIFIED** and is not used in code. Code comments cite the same sources.

Sources used:
- Docs: `https://docs.injective.network/<page>.md` (raw markdown) and `llms.txt` index.
- Vendored skills: `.claude/skills/injective-*` (InjectiveLabs/agent-skills, MIT).
- Packages: `@injectivelabs/sdk-ts@1.20.66`, `@injectivelabs/networks@1.20.66`, `@injectivelabs/utils@1.20.66`,
  `@injectivelabs/core-proto-ts-v2@1.20.5`, `@injectivelabs/x402@0.0.1`.
- Source: `github.com/InjectiveLabs/sdk-go` (chain message validation), `github.com/InjectiveLabs/injective-agent-cli` (commit 381a270).
- Live queries: Indexer gRPC-web, chain gRPC-web and REST gateway, EVM JSON-RPC (`eth_getCode`), testnet transactions listed below.

## 1. Verified facts

| Fact | Value | Source |
|---|---|---|
| Indexer / chain endpoints | From `getNetworkEndpoints(Network.Mainnet \| MainnetK8s \| MainnetLB)` and `(Network.Testnet \| TestnetK8s)`. Never hand-written. | `@injectivelabs/networks`, `services/agent/src/injective/endpoints.ts` |
| Mainnet native USDC, EVM | `0xa00C59fF5a080D2b954d0c75e46E22a0c371235a`, 6 decimals, 1765 bytes of code | docs `developers-defi/usdc-stablecoin`, `eth_getCode` on chain 1776 |
| Mainnet native USDC, bank denom | `erc20:0xa00C59fF5a080D2b954d0c75e46E22a0c371235a` (mixed case as stored on chain) | live chain v2 market `quote_denom`; the usdc-integration skill shows it lowercased, use the chain string |
| Testnet native USDC, EVM | `0x0C382e685bbeeFE5d3d9C29e29E341fEE8E84C5d`, 6 decimals, 1765 bytes of code | docs `developers-defi/usdc-stablecoin` (Testnet tab), `eth_getCode` on chain 1439 |
| Testnet native USDC, bank denom | `erc20:0x0C382e685bbeeFE5d3d9C29e29E341fEE8E84C5d` | live testnet market `quote_denom` |
| Testnet USDT | bank denom `peggy0x87aB3B4C8661e07D6372361211B96ed4Dc36B1B5`, 6 decimals | live testnet USDT perps `quote_denom`, `quote_decimals` |
| CCTP domain | 29 on both networks | docs `developers-defi/usdc-stablecoin` |
| USDC transfer gas | USDC runs an EVM compliance hook; an out-of-gas inside it shows as "restricted action". We pad ERC-20 gas x2. | docs USDC FAQ |
| Market params | Chain exchange v2 (`/injective/exchange/v2/derivative/markets`) returns human decimals (DOGE tick `0.0001`). Indexer v1 returns the price tick and min notional x10^quoteDecimals (`100`, `1000000`) and the quantity tick human. `fetch-markets` cross-checks every market: 0 mismatches on both networks. | live, `scripts/fetch-markets.ts` |
| Order units | `MsgBatchUpdateOrdersV2` (`/injective.exchange.v2.MsgBatchUpdateOrders`) takes human price, quantity and margin; sdk-ts applies the 10^18 Dec encoding. No quote-decimal scaling. | sdk-ts source (`MsgBatchUpdateOrdersV2.toProto` uses `toChainFormat`), testnet txs below |
| Legacy v1 scaling gotcha | v1 `fromJSON` expected price x10^6; not used by STRATA. | injective-mcp-servers skill, "SDK fromJSON Scaling" |
| Chain v2 query values | gRPC `Dec` strings are human x10^18 (testnet BTC level `63272000000000000000000` = 63272). | live `injective.exchange.v2.Query/DerivativeOrderbook` |
| Indexer trade / book format | `executionPrice`, `fee`, book `price` are x10^quoteDecimals; `executionQuantity`, book `quantity` are human. `tradeId` = `<blockHeight>_<eventIndex>`; trades carry no tx hash. cids up to 36 chars (UUIDs) seen live. | live mainnet SICI trades, testnet orderbook |
| Default subaccount | Index 0 trades straight from the bank balance. `MsgDeposit` into it is rejected ("subaccount id is not valid"). The chain deposit query returns 0 for it, so the adapter reads the bank balance. Use index 1+ for isolated deposits. | `InjectiveLabs/sdk-go` `chain/exchange/types/v2/msgs.go` `MsgDeposit.ValidateBasic`, testnet tx attempt |
| Post-only | Order types `BUY_PO = 7`, `SELL_PO = 8` (exchange v2 `OrderType`). | `core-proto-ts-v2` `injective/exchange/v2/order_pb`, testnet txs below |
| Reduce-only | Margin `0`; close with 1% slippage, not 5% (bankruptcy price check). | injective-mcp-servers skill, "Close Orders" |
| Margin buffer | +2% over `price x qty x IMR`, against `max(order price, mark)`. | injective-trading-account skill, "Margin Calculation" |
| Cosmos signing | sign `keccak256(signBytes)`, signature `r \|\| s` (64 bytes), pubkey = compressed secp256k1 base64. | sdk-ts `PrivateKey.sign`, `MsgBroadcasterWithPk.prepareTxForBroadcast` |
| Fresh accounts | `MsgBroadcasterWithPk` fails for accounts that never sent a tx because it reads the pubkey from chain. Our signer supplies the pubkey from the KeyHandle; strata-test-3 broadcast its first ever tx this way (authz smoke below) with no EVM priming. The adapter still exposes `primeAccountIfNeeded()` (one 0-value EVM self-transfer, PRD 4.4). | injective-evm-developer skill, testnet tx `803CD52C...` |
| Gas | Cosmos fee = gas x 160,000,000 `inj` (`DEFAULT_GAS_PRICE`); simulate + 30%. EVM: legacy type 0, gasPrice 160e6 wei. A batch order tx used about 0.00003 INJ. | `@injectivelabs/utils`, PRD 4.4 |
| EVM receipts | `eth_getTransactionReceipt` can fail transiently; we poll with backoff and never hard-fail. | injective-evm-developer skill |
| Chain time | Latest block header time via `ChainGrpcTendermintApi.fetchLatestBlock`, cached 1 s. Never the local clock. | sdk-ts |
| Oracle timestamps | The Indexer oracle API has no timestamps. We read the chain oracle module: `OraclePrice` (base/quote timestamps) and `ProviderPriceState` (provider feeds). Values are Dec x10^18. | `core-proto-ts-v2` `injective/oracle/v1beta1/query`, live |
| Pyth Pro metadata | `https://pyth.dourolabs.app/v1/symbols` (no auth) gives `asset_type` and the market-hours `schedule` for every Pyth Pro feed id used by `pythpro` markets. | docs.pyth.network `llms-price-feeds-pro.txt` |
| Pyth Hermes | Since 2026-08-26 every `hermes.pyth.network` request needs an API key. The two-source reference check needs a key, so `MarketState.reference` is `null` until one is provided. | docs.pyth.network `llms-price-feeds-core.txt` |
| Testnet faucet | Web page uses hCaptcha / Turnstile. The documented API `POST https://jsbqfdd4yk.execute-api.us-east-1.amazonaws.com/v1/faucet` returns HTTP 404 today. | docs `developers-defi/testnet-faucet-integration`, live |

## 2. Arena markets (live fetch, `packages/config/src/generated/markets.<network>.json`)

Mainnet: 354 active perpetuals (166 crypto, 166 equity, 11 fx, 8 commodity, 2 index, 1 compute). All USDC margined.

| Ticker | Market ID | Class | Oracle | Tick / qty tick / min notional | Maker / taker | IMR / MMR |
|---|---|---|---|---|---|---|
| SICI/USDC PERP | `0x6751442adea73a2b65adce484dd7bde25d204c9695fc9d5410933171f3417410` | compute | provider `SICI/USDC` by `InjectiveLabs` | 0.01 / 0.001 / 1 | 0.000001 / 0.000001 | 0.083333 / 0.05 |
| XAU/USDC PERP | `0x8f4ae01ef8027fcefa40b6465638c62da324f71755e7513fad37b2334c9291b5` | commodity | pythpro 346 (Metal.XAU/USD) / 7 (USDC/USD) | 0.01 / 0.0001 / 1 | 0.000001 / 0.000001 | 0.019231 / 0.01 |
| EURUSD/USDC PERP | `0x220120852298978d37c47c2c7893e7df51e783451fbef1edc7c745a59201c8e5` | fx | pythpro 327 (FX.EUR/USD) / 7 | 0.00001 / 0.1 / 1 | 0.000001 / 0.000001 | 0.009901 / 0.005 |
| USTECH/USDC PERP | `0x57d55fd4f27ebc19c453792a636a7471a473ab616e72c3949121684d5186fe3a` | index | pythpro 1363 (Equity.US.QQQ/USD) / 7 | 0.01 / 0.001 / 1 | 0.000001 / 0.000001 | 0.019231 / 0.01 |

Also available on mainnet (not enabled): US500/USDC PERP `0x7b3bcf125dfa50ae8d44ecb60119ef5d52a627ad757b727850b0903b55e49b2c` (pythpro 1398, SPY), XAG, WTI, BRENT, NATGAS, COPPER, GBPUSD, USDJPY and others.

Testnet: 18 active perpetuals. **No SICI and no live RWA perp on testnet.** GOLD/USDT, EVINDEX/USDT and TRUCPI/USDT exist but their price-feed oracles last updated in 2023 and they are USDT margined. Enabled (USDC quote, live oracle):

| Ticker | Market ID | Class | Oracle age at fetch |
|---|---|---|---|
| BTC/USDC PERP | `0xfd704649cf3a516c0c145ab0111717c44640d8dbe52a462ae35cadf2f6df1515` | crypto | 1 s (chainlinkdatastreams) |
| ETH/USDC PERP | `0x135de28700392fb1c17d40d5170a74f30055a4ad522feddafec42fbbbb780897` | crypto | 1 s |
| INJ/USDC PERP | `0xdc70164d7120529c3cd84278c98df4151210c0447a65a2aab03459cf328de41e` | crypto | 1 s (pythpro 46) |
| LINK/USDC PERP | `0xdbb9bb072015238096f6e821ee9aab7affd741f8662a71acc14ac30ee6b687a5` | crypto | 1 s |
| MUN-PERP | `0xeccc2f12a231d55a99e973b7dbfce06de2b12b535cd56ae08a49c60ad0b5feb6` | index | 21 min (provider N10Labs, slow tier) |
| BHA-PERP | `0x5cd44dc50348a8d2c9bd9c58765cb4b3f25a88d700f78a24597578ab2484d4da` | index | 2.9 h (slow tier) |
| LIV-PERP | `0x4d57b65966a7391751581c699df8c441efff3d2c51e4827db2c6b5dc88ecedb5` | index | 2.9 h (slow tier) |

The N10Labs index perps have a negative maker fee (-0.0002). Testnet books are thin and odd (INJ/USDC: bid 3, ask 4.9 against an oracle of 8.1), so testnet spread numbers mean little; label them TESTNET.

### Asset-class heuristic (`services/agent/src/injective/markets/classify.ts`)
First match wins: (1) base `SICI` or Pyth `compute` -> compute; (2) `US500`, `USTECH`, `EVINDEX`, `TRUCPI`, provider symbols ending `.INDEX` -> index (Pyth labels the SPY/QQQ feeds "equity", but on Injective these are the broad index perps); (3) pythpro markets use the Pyth Pro `asset_type` (equity, fx, metal/commodity -> commodity, crypto/crypto-index/redemption-rate -> crypto, interest-rate/nav/macro -> index); (4) WTI, BRENT, NATGAS, COPPER, GOLD, SILVER, XAU, XAG, XPT, XPD -> commodity; (5) two ISO 4217 codes -> fx; (6) everything else -> crypto. The matched rule is stored per market in `market-sessions.<network>.json` (`classificationRule`). Tokenized gold (XAUT, PAXG) is crypto because it trades 24/7 as a token and Pyth labels it crypto.

### Testnet arena selection rule
USDC quote, not a `qa*` test market, oracle age at most 15 min at fetch time, non-crypto first, up to 8. If fewer than 5 qualify, non-crypto USDC markets with an oracle age up to 6 h are added as a slow tier (the Oracle Guard still halts them when stale).

## 3. Oracles and market hours (observed 2026-11-08 18:40 UTC, a Sunday)

| Market | Oracle | Behaviour |
|---|---|---|
| SICI/USDC | `provider` (`InjectiveLabs`, symbol `SICI/USDC`), relayed by whitelisted relayers via `MsgRelayProviderPrices` | Updated within the last few seconds on a Sunday: published 24/7. No public schedule. **UNVERIFIED**: how the provider computes the index outside GPU rental market updates. |
| XAU/USDC | `pythpro` 346 Metal.XAU/USD over 7 Crypto.USDC/USD | Last base update 2026-11-06 22:00 UTC (Friday 17:00 New York). Pyth schedule `America/New_York;0000-1700&1800-2400 Mon-Thu, Fri 0000-1700, Sat closed, Sun 1800-2400` plus holiday overrides. The oracle simply stops updating while closed. |
| EURUSD/USDC | `pythpro` 327 FX.EUR/USD / 7 | Stopped Friday 17:00 New York; schedule `O,O,O,O,0000-1700,C,1700-2400` (Sunday 17:00 open). |
| USTECH/USDC | `pythpro` 1363 Equity.US.QQQ/USD / 7 | Last update Friday 16:00 New York (2026-11-06 21:00 UTC). Schedule `0930-1600` Mon-Fri, US holidays closed, early closes 1127 and 1224 at 1300. |
| Crypto (Chainlink Data Streams, pythpro crypto) | `chainlinkdatastreams`, `pythpro` | 24/7, age about 1 s. |

The full Pyth schedule string per market is in `packages/config/src/generated/market-sessions.<network>.json` (`pythSchedule`), ready for the Session Guard (PRD 9.5). While the underlying is closed the mark stays next to the frozen oracle (XAU on Sunday: mark 4071.47, oracle 4071.44), so off-hours books trade against a stale reference. This is the weekend-gap risk the Session Guard exists for.

## 4. How STRATA sends orders (and why not the precompile)

We use Cosmos `MsgBatchUpdateOrdersV2` (one tx: cancels first, then creates) signed by a KeyHandle from `@strata/keys`, because:
- it is the native exchange message the docs and skills describe for market makers, and it supports `derivativeMarketIdsToCancelAll` and in-batch market orders (used for reduce-only closes);
- the response gives created order hashes and failed cids (`MsgBatchUpdateOrdersResponse`, decoded in `decode.ts`);
- authz scoping (below) is stricter on the Cosmos path.

Exchange precompile equivalent (address `0x0000000000000000000000000000000000000065`, `.claude/skills/injective-evm-developer/assets/Exchange.sol`), documented for completeness, not used in code:
- `batchUpdateOrders(address sender, BatchUpdateOrdersRequest)` with `DerivativeOrder.orderType` as a string `"buy" | "sell" | "buyPostOnly" | "sellPostOnly"` and API FORMAT values (human x10^18).
- `deposit / withdraw / subaccountTransfer` in CHAIN FORMAT (native token decimals).
- `approve(grantee, Authorization[])` with `MsgType_BatchUpdateOrders = 7` and a `spendLimit`, `revoke`, `allowance`. These are per message type with a spend limit; they cannot restrict markets or the subaccount the way `BatchUpdateOrdersAuthz` does.

## 5. Scoped trading grants (PRD 16.1)

Injective exchange v2 defines typed authz authorizations: `CreateDerivativeLimitOrderAuthz`, `CreateDerivativeMarketOrderAuthz`, `BatchCreateDerivativeLimitOrdersAuthz`, `CancelDerivativeOrderAuthz`, `BatchCancelDerivativeOrdersAuthz`, `BatchUpdateOrdersAuthz` (each with `subaccount_id` and market id lists) and `GenericExchangeAuthorization` (`core-proto-ts-v2` `injective/exchange/v2/authz_pb`). Grants use cosmos `MsgGrant` and are executed with `MsgExec` (docs `developers-native/examples/authz`).

STRATA grants only `injective.exchange.v2.BatchUpdateOrdersAuthz { subaccount_id: <owner subaccount>, derivative_markets: [arena markets] }`. The hot key can place and cancel orders on those markets for that subaccount and nothing else: no send, withdraw or transfer (the autosign skill's never-grant list is enforced in `authz.ts`).

```
pnpm --filter @strata/agent inj:grant-trading -- --granter <owner-key> --grantee <agent-key> --markets arena --days 7 --check
pnpm --filter @strata/agent inj:grant-trading -- --granter <owner-key> --grantee <agent-key> --revoke
```
`--check` proves the negative: the grantee signs `MsgExec(MsgSend)` from the granter and the chain refuses it ("failed to get grant with given granter"). Mainnet grants need `--network mainnet` and `STRATA_ALLOW_MAINNET=yes` (owner action).

Verified on testnet (granter strata-test-2, grantee strata-test-3, 7 arena markets):
- grant tx `E0B6BEBA36C916B96E22B3952033E68FB2E33B5F950C8627DB3D0E95EFCB1F9D`; negative check refused.
- place through grant `803CD52C91F63C10E6AAF15C47A55E4D2703884BF5C5710CE8501290F1A3D97D`, cancel `A4E3EE1DC2CF43DD1AE9017D625CBBB4D6E3C083F2F2C5DABF2A28433F5EAF6F`.

Note for OLP: the OLP eligibility page itself recommends authz to run several strategies from one address so maker volume counts once.

## 6. ERC-8004 agent identity

| Item | Value | Source |
|---|---|---|
| Identity registry, mainnet (1776) | `0x8004A169FB4a3325136EB29fA0ceB6D2e539a432` (proxy, 130 bytes code) | `InjectiveLabs/injective-agent-cli` `src/lib/config.ts` @381a270, `eth_getCode` |
| Reputation registry, mainnet | `0x8004BAa17C55a88189AE136b182e5fdA19dE9b63` | same |
| Identity registry, testnet (1439) | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | same, `eth_getCode`; W1 also checked `supportsInterface(ERC721)` |
| Reputation registry, testnet | `0x8004B663056A597Dffe9eCcC1965A193B7388713` | same |
| Validation registry | `0x0000000000000000000000000000000000000000` on both (not deployed) | same |
| "staging" registries on testnet | `0x19d1...c8e` etc., Injective's early deployment. Not used. | same |

Flow (agents.injective.com/start and /erc-8004): clone `https://github.com/InjectiveLabs/injective-agent-cli`, `pnpm install && pnpm run build && pnpm link --global`, set `INJ_PRIVATE_KEY` and `INJ_NETWORK` in `.env`, fund with testnet INJ, `inj-agent register` mints an ERC-721 style agent token (`register(cardUri[, metadata])`, optional `setAgentWallet`), `inj-agent update --name --description --metadataURI`, `inj-agent list`, `inj-agent status <tokenId>`, `inj-agent mcp` for an MCP server. On-chain fields: tokenId, agentType, metadataURI (IPFS agent card JSON), feeRecipient, status. **UNVERIFIED**: the agent card JSON schema (the site says "name, description, capabilities"; no schema published). Note: the CLI reads a raw key from `.env`; STRATA should call the registry from our own KeySource signer instead of putting keys in `.env`.

## 7. x402

- Package `@injectivelabs/x402` (latest `0.0.1`, `next` `0.1.0-rc.1`), deps `viem`, `zod`, peer `express`. Exports: `/middleware` (`injectivePaymentMiddleware(routes, { facilitator: { privateKey }, settlementPolicy })`), `/client` (`createInjectiveClient({ privateKey }).fetch(url)`), `/facilitator` (`new InjectiveFacilitator({ privateKey, allowedAssets, minPaymentPerAsset })`), `/protocol` (`normalizeFacilitatorRequest`, `verifyPaymentRequest`, `encodeTransferWithAuthorizationCalldata`), `/networks` (`INJECTIVE_MAINNET_CAIP2 = "eip155:1776"`, `INJECTIVE_TESTNET_CAIP2 = "eip155:1439"`), `/eip3009`, `/schemas`.
- Payment asset: native USDC (EIP-3009 `transferWithAuthorization`, Circle FiatTokenV2_2) on both networks. USDT `0x88f7F2b685F9692caf8c478f5BADF09eE9B1Cc13` has no EIP-3009 and cannot be used.
- Hosted facilitator: the README names `x402.injective.network`. **UNVERIFIED / not live**: DNS returns NXDOMAIN on 2026-11-09. W6 should run its own `InjectiveFacilitator` (a funded INJ gas key from KeySource) and add the idempotency cache the README asks for.

## 8. Open Liquidity Program (OLP)

- Rewards in INJ per 28-day epoch, subject to governance. Epoch 65: 2026-10-27 to 2026-11-24, 10,000 INJ. Epoch 66: 2026-11-24 to 2026-12-22, 10,000 INJ. (docs `defi/open-liquidity-program/epochs`)
- Eligibility: opt the address out of Trade & Earn first; then at least 0.25% of total daily maker volume of eligible markets for 3 days in a row in one epoch; qualifies on day 4. Must keep 0.25% of cumulative eligible maker volume to stay qualified for the next epoch. Self trading is prohibited. (docs `defi/open-liquidity-program/eligibility`)
- Scoring, VRMs, fee tiers: docs `defi/open-liquidity-program/scoring`, `volatility-response-modifications`, `fee-tiers`.
- **UNVERIFIED**: the current list of OLP-eligible markets. It lives on the OLP dashboard (`trading.injective.network/program/liquidity`), a JS app we did not scrape. Check it in a browser before claiming any arena market is OLP-eligible.
- At $1,000 of capital, 0.25% of exchange maker volume is not realistic; do not promise OLP rewards.

## 9. Testnet transactions (W3 integration test, chain injective-888)

| What | Tx |
|---|---|
| Post-only buy 0.38 INJ @ 4.054 on INJ/USDC PERP (strata-test-1, subaccount 0) | `0EBEB1CF54F0B009904084B1FF9AD3584703D6AE86A4D83C68E34DE4CCE80052` |
| Cancel of that order | `BFC5274AB2E14948CFB679981743734880353A7CA12C427AEA96D3E4F51A4C47` |
| Post-only buy 1 INJ @ 1.5 (half of the lower of oracle and best bid) | `C0BB37351EE0A880F14BE5BF1C05A57BA641AAA081A8FAC0575AB9383862B4FA` |
| Cancel of that order | `7D0093F6080E4E9BDB5D1C93488B5B9410B2C52D734D8FD71AFD3A9E9CA025AC` |
| Authz grant, place via grant, cancel via grant | see section 5 |

Each order was verified present, then absent, on both the chain (`TraderDerivativeOrders`) and the Indexer (`fetchOrders`). Explorer: `https://testnet.explorer.injective.network/transaction/<hash>`. Rerun: `pnpm --filter @strata/agent inj:testnet-smoke`.

## 10. Adapter usage

```ts
import { createInjectiveAdapter } from "./injective/index.js";
import { KeystoreKeySource } from "@strata/keys";
const adapter = await createInjectiveAdapter({
  network: "testnet",
  keySource: new KeystoreKeySource(),
  keyName: "strata-test-1",
  subaccountIndex: 0,          // 0 = bank-funded default subaccount
  marketIds: ["0xdc70...e41e"],
  granter: undefined,          // set to the owner inj1 address to trade through an authz grant
});
```
- `getMarketState`: book (stream, or chain read when older than 3 s), oracle with report time, mark, chain time, position, available quote, last funding rate, margin ratio. `reference` is null (see Pyth Hermes).
- `batchUpdate`: one `MsgBatchUpdateOrdersV2`; prices snapped away from the touch, quantity snapped down, min notional and cid checked locally and returned in `rejected`; chain-side failed cids are also returned in `rejected`.
- `cancelAll`: `derivativeMarketIdsToCancelAll`, safe to repeat. `closePositionReduceOnly`: cancel-all plus a reduce-only market order, 1% through mark.
- `onFill`: Indexer trade stream for the subaccount; on reconnect the last 100 trades are re-read and deduplicated by `tradeId`. `FillEvent.txHash` is empty because the Indexer trade has no tx hash: key fills on `tradeId` (`<blockHeight>_<eventIndex>`).
- Streams: orderbooks, trades, positions via `IndexerGrpcDerivativesStreamV2`, reconnect with jittered exponential backoff (0.5 s to 30 s), rotating across every endpoint bundle, idle watchdog. Chain Stream (`infra/websocket-server` docs) is an alternative we did not need.

## 11. Known gaps

- `MarketState.reference` is null until a Pyth API key exists (Hermes now needs one).
- Funding rate is the last applied hourly rate from the Indexer, not a forecast.
- `LiveOrder.createdAtMs` is when the adapter first saw the order; the chain does not expose order creation time.
- Testnet has no SICI and no live RWA perps, so the testnet arena is crypto plus slow-updating N10Labs index perps.
