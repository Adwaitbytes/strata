# Injective Options: what exists, and the STRATA simulator

Researched 2026-11-09. Decision D9: the options agent runs **SIMULATED** until writer access is granted.

## What we could verify

| Item | Status | Source |
|---|---|---|
| Product launch | Injective Options launched on testnet on 2026-10-27. | Secondary coverage: AltcoinBuzz, edgeX news ("Injective Launches Fully Collateralized Onchain Options"), OurCryptoTalk. They cite Injective's announcement on X (status 2115080634754310172), which we did not read directly. |
| Design | European style, cash settled in USDC, calls and puts. Fully collateralized: the writer locks the maximum payout in native USDC until expiry. Early close if both sides agree. | Same secondary sources. **UNVERIFIED** against Injective docs. |
| Markets | Six on testnet: SICI, US500, US Tech, Gold, Silver, WTI crude. | Same. **UNVERIFIED**. |
| Writer access | Writing is limited to whitelisted participants; an institutional liquidity provider quotes both sides. No application process is published. | Same. |
| Docs | No options page in `docs.injective.network/llms.txt`. The only options content is the older **binary options** market type (`developers-native/injective/exchange/02_binary_options_markets`). | Live docs index. |
| Chain / SDK interface | `@injectivelabs/sdk-ts@1.20.66` and `core-proto-ts-v2@1.20.5` contain binary options messages only, no call/put writer messages. Testnet `/injective/exchange/v2/binary_options/markets` lists 3 legacy binary markets (e.g. `GOLDS>60USDS-DEC26`), none of the six new products. | Package typings, live testnet query. |
| GitHub | No public InjectiveLabs repository for the options product (`gh search repos --owner InjectiveLabs options` returns nothing). | GitHub search. |
| Contract addresses, module name, frontend URL, expiry schedule, strikes, collateral cap for calls | **UNVERIFIED**, not published. | |

Conclusion: there is no usable public writer interface today. We do not guess one. The options agent uses the simulator below and every number it produces carries `provenance: "SIMULATED"`.

## Simulator payoff model (for W2 and the options agent)

Everything here is STRATA's model of the published design, not Injective's contract logic. When Injective publishes the real interface, replace the settlement and collateral rules with theirs.

### Contract
```
SimOption {
  id: string
  network: "testnet"
  provenance: "SIMULATED"          // always
  underlying: "SICI" | "US500" | "USTECH" | "XAU" | "XAG" | "WTI"
  underlyingMarketId: Hex32        // the perp whose oracle settles it (mainnet ids in docs/INJECTIVE.md section 2)
  kind: "call" | "put"
  strike: DecimalString            // USD
  expiryMs: number                 // European: exercise only at expiry
  size: DecimalString              // units of the underlying
  maxPayoutPerUnit: DecimalString  // call: strike x callCapMultiple (default 1.0, i.e. payoff capped at 2 x strike); put: strike
  premium: DecimalString           // USDC received by the writer at open
  collateral: DecimalString        // = size x maxPayoutPerUnit, locked until settlement
  status: "open" | "settled" | "closed_early"
}
```

### Settlement (cash, USDC)
- Settlement price `S_T` = the Injective chain oracle price of `underlyingMarketId` at the first report at or after `expiryMs` (`OraclePrice` / `ProviderPriceState`, see `services/agent/src/injective/oracle.ts`). If the underlying is closed at expiry (Pyth schedule in `market-sessions.<network>.json`), use the last report before close and flag `settledOnStaleOracle`.
- Holder payoff per unit:
  - call: `min(max(S_T - K, 0), maxPayoutPerUnit)`
  - put: `min(max(K - S_T, 0), maxPayoutPerUnit)` (a put can never pay more than `K`)
- Writer PnL = `premium - size x payoffPerUnit - fees`. Collateral is released at settlement minus the payoff.
- Fully collateralized means the writer can never owe more than `collateral`. The simulator rejects any write where free USDC < `collateral` ("never naked", PRD 9.8).

### Writer strategy inputs (PRD 9.8)
- Covered calls and cash-secured puts only, delta 0.15 to 0.30, short-dated (weekly, expiring at a time the underlying is open: Friday 16:00 New York for US500/USTECH, Friday 17:00 New York for XAU/XAG/WTI, any time for SICI which is published 24/7).
- Fair value: Black-76 on the perp mark, `sigma` = max(EWMA realized vol of the oracle, floor). Premium floor: quote only if implied vol of our premium >= realized vol x `ivFloorMultiple` (default 1.2).
- Early close: allowed at `fair value x (1 + closeSpread)` if both sides agree; simulated buyers accept with a probability that falls with distance from fair value. Label this behavior SIMULATED in the UI.

### What the UI must show
- Every options number labeled `SIMULATED`, never next to LIVE numbers without the label.
- The settlement oracle, the collateral locked, and the max loss per contract (`collateral - premium`).
