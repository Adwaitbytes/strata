import { describe, expect, it } from "vitest";
import { baseSymbol, classifyMarket, isFxPair } from "./classify.js";
import type { PythSymbolMeta } from "./classify.js";

const pyth = (assetType: string, symbol = "X"): PythSymbolMeta => ({ id: 1, symbol, assetType, schedule: null, hermesId: null });
const input = (ticker: string, oracleType: string, oracleBase = "", p: PythSymbolMeta | null = null) => ({
  ticker,
  oracleType,
  oracleBase,
  oracleQuote: "",
  pyth: p,
});

describe("baseSymbol", () => {
  it.each([
    ["XAU/USDC PERP", "XAU"],
    ["LIV-PERP", "LIV"],
    ["qaBTC/USDC PERP", "qaBTC"],
    ["EURUSD/USDC PERP", "EURUSD"],
  ])("%s -> %s", (ticker, base) => expect(baseSymbol(ticker)).toBe(base));
});

describe("isFxPair", () => {
  it("accepts ISO pairs and rejects crypto tickers", () => {
    expect(isFxPair("EURUSD")).toBe(true);
    expect(isFxPair("USDJPY")).toBe(true);
    expect(isFxPair("BTCUSD")).toBe(false);
    expect(isFxPair("USDC")).toBe(false);
  });
});

describe("classifyMarket", () => {
  it("SICI is compute regardless of oracle", () => {
    expect(classifyMarket(input("SICI/USDC PERP", "provider", "SICI/USDC")).assetClass).toBe("compute");
  });

  it("US index perps are index even though Pyth labels the ETF feed equity", () => {
    expect(classifyMarket(input("USTECH/USDC PERP", "pythpro", "1363", pyth("equity", "Equity.US.QQQ/USD"))).assetClass).toBe("index");
    expect(classifyMarket(input("US500/USDC PERP", "pythpro", "1398", pyth("equity"))).assetClass).toBe("index");
  });

  it("uses Pyth asset_type for pythpro feeds", () => {
    expect(classifyMarket(input("XAU/USDC PERP", "pythpro", "346", pyth("metal"))).assetClass).toBe("commodity");
    expect(classifyMarket(input("EURUSD/USDC PERP", "pythpro", "327", pyth("fx"))).assetClass).toBe("fx");
    expect(classifyMarket(input("NVDA/USDC PERP", "pythpro", "1314", pyth("equity"))).assetClass).toBe("equity");
    // Tokenized gold trades 24/7 as a crypto token; Pyth labels it crypto and so do we.
    expect(classifyMarket(input("XAUT/USDC PERP", "pythpro", "172", pyth("crypto"))).assetClass).toBe("crypto");
  });

  it("provider commodity feeds and provider index symbols", () => {
    expect(classifyMarket(input("WTI/USDC PERP", "provider", "WTI/USDC")).assetClass).toBe("commodity");
    expect(classifyMarket(input("LIV-PERP", "provider", "LIV.INDEX")).assetClass).toBe("index");
    expect(classifyMarket(input("GOLD/USDT PERP", "pricefeed", "GOLD")).assetClass).toBe("commodity");
  });

  it("FX pairs without Pyth metadata fall back to the ISO rule", () => {
    expect(classifyMarket(input("GBPUSD/USDC PERP", "pythpro", "333", null))).toEqual({ assetClass: "fx", rule: "fx-iso-pair" });
  });

  it("everything else is crypto, with the rule recorded", () => {
    expect(classifyMarket(input("BTC/USDC PERP", "chainlinkdatastreams", "0x0003"))).toEqual({
      assetClass: "crypto",
      rule: "chainlink-data-streams-crypto",
    });
    expect(classifyMarket(input("qaBTC/USDC PERP", "pricefeed", "qaBTC")).rule).toBe("default-crypto");
  });
});
