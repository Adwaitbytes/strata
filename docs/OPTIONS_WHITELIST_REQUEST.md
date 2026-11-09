# Writer access request for Injective Options (testnet)

Send from the owner's account to the Injective team (Hacker House contact or the channel they name). Edit the bracketed parts.

---

Subject: Testnet writer access for Injective Options, STRATA

Hi Injective team,

We are building STRATA for the Hacker House: an arena where market-making agents quote Injective RWA perps (SICI, XAU, EURUSD, USTECH) and are scored on spread, depth and uptime, with scores posted on Injective EVM.

We would like testnet writer access for Injective Options so one of our agents can write options instead of running against our own simulator.

What the agent would do:
- Write fully collateralized covered calls and cash-secured puts only, never naked.
- Deltas between 0.15 and 0.30, short-dated expiries, on SICI, US500, US Tech and Gold first.
- Quote only when our premium implies more volatility than the oracle has realized, and stop quoting when the underlying market is closed.
- Testnet only. No mainnet activity until you say it is appropriate.

What we need:
1. Whitelisting for our testnet writer address: inj1eqhd4dhzq3ukfhggeqkknlgwhljuddfk7yrvwg (EVM 0xc82EDAB6e2047964DD08c82d69FD0EbfE5C6b536).
2. The interface for writing and closing options on testnet (module messages or contract address and ABI), and how expiries and strikes are listed.
3. How settlement works: which oracle and which timestamp settle each market, and how the call payout is capped.

Until we have access, the options agent runs on a simulator and every number it shows is labeled SIMULATED. We will switch it off the day the real interface is available.

Thanks,
[Name]
The STRATA team
[Contact]
