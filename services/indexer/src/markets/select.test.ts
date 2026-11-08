import { describe, expect, it } from "vitest";
import type { RawDerivativeMarket } from "../injective/reader.js";
import { selectBaselineMarkets } from "./select.js";

const mk = (ticker: string, id: string, extra: Partial<RawDerivativeMarket> = {}): RawDerivativeMarket => ({
  marketId: id, ticker, marketStatus: "active", isPerpetual: true, oracleType: "pythpro", oracleBase: "1", oracleQuote: "7",
  oracleScaleFactor: 0, quoteDenom: "usdc", quoteDecimals: 6, raw: {}, ...extra,
});
const live = [
  mk("BTC/USDC PERP", "0x01"), mk("AAPL/USDC PERP", "0x02"), mk("SICI/USDC PERP", "0x03"), mk("XAU/USDC PERP", "0x04"),
  mk("LIV-PERP", "0x05"), mk("TSLA/USDC PERP", "0x06", { marketStatus: "paused" }), mk("EURUSD/USDC PERP", "0x07"),
];

describe("selectBaselineMarkets", () => {
  it("keeps active RWA perps, story markets first", () => {
    const out = selectBaselineMarkets("mainnet", live);
    expect(out.map((m) => m.ticker)).toEqual(["SICI/USDC PERP", "XAU/USDC PERP", "EURUSD/USDC PERP", "AAPL/USDC PERP"]);
  });
  it("always includes arena-configured markets, ranked first, with their asset class", () => {
    const out = selectBaselineMarkets("testnet", live, [{ marketId: "0x05", assetClass: "index" }], 2);
    expect(out.map((m) => m.marketId)).toEqual(["0x05", "0x03"]);
    expect(out[0]?.assetClass).toBe("index");
  });
});
