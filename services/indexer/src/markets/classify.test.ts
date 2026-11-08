import { describe, expect, it } from "vitest";
import { baseSymbol, classifyRwa, isFxPair } from "./classify.js";

describe("classifyRwa", () => {
  it("classifies the PRD 9.9 house-agent markets", () => {
    expect(classifyRwa("SICI/USDC PERP")).toBe("compute");
    expect(classifyRwa("XAU/USDC PERP")).toBe("commodity");
    expect(classifyRwa("EURUSD/USDC PERP")).toBe("fx");
    expect(classifyRwa("USTECH/USDC PERP")).toBe("index");
  });
  it("classifies equities and testnet RWA tickers", () => {
    expect(classifyRwa("AAPL/USDC PERP")).toBe("equity");
    expect(classifyRwa("GOLD/USDT PERP")).toBe("commodity");
    expect(classifyRwa("EVINDEX/USDT PERP")).toBe("index");
  });
  it("returns null for crypto and ambiguous symbols", () => {
    for (const t of ["BTC/USDC PERP", "DOGE/USDC PERP", "A/USDC PERP", "SPX/USDC PERP", "H/USDC PERP"]) {
      expect(classifyRwa(t)).toBeNull();
    }
  });
  it("parses base symbols", () => {
    expect(baseSymbol("LIV-PERP")).toBe("LIV");
    expect(baseSymbol("qaBTC/USDC PERP")).toBe("QABTC");
  });
  it("detects USD FX pairs only", () => {
    expect(isFxPair("USDJPY")).toBe(true);
    expect(isFxPair("EURGBP")).toBe(false);
    expect(isFxPair("USDUSD")).toBe(false);
    expect(isFxPair("NVDAXX")).toBe(false);
  });
});
