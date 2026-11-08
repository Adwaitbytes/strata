import { describe, expect, it } from "vitest";
import { decFromChain, isMultipleOf, notional, orderMargin, quantize, scaleDown } from "./units.js";

describe("units", () => {
  it("converts cosmos Dec integers to human strings", () => {
    // Live XAU/USDC pythpro pair price read on 2026-11-09.
    expect(decFromChain("4071441823968711996605")).toBe("4071.441823968711996605");
    expect(decFromChain("105341930000000000000")).toBe("105.34193");
    expect(decFromChain("0")).toBe("0");
  });

  it("scales Indexer chain-format ticks down by quote decimals", () => {
    // DOGE/USDC: indexer minPriceTickSize 100, chain v2 says 0.0001.
    expect(scaleDown(100, 6)).toBe("0.0001");
    expect(scaleDown("1000000", 6)).toBe("1");
  });

  it("quantizes to ticks without float error", () => {
    expect(quantize("4071.4567", "0.01", "down")).toBe("4071.45");
    expect(quantize("4071.4567", "0.01", "up")).toBe("4071.46");
    expect(quantize("1.11449", "0.00001", "nearest")).toBe("1.11449");
    expect(quantize("0.3", "0.1", "down")).toBe("0.3");
    expect(isMultipleOf("0.3", "0.1")).toBe(true);
    expect(isMultipleOf("0.35", "0.1")).toBe(false);
    expect(() => quantize("1", "0", "down")).toThrow();
  });

  it("computes buffered margin against the higher of order and mark price", () => {
    // 0.01 XAU at 4000, mark 4071, IMR 0.019231, buffer 1.02 -> 4071*0.01*0.019231*1.02 = 0.79855...
    expect(orderMargin({ price: "4000", quantity: "0.01", markPrice: "4071", initialMarginRatio: "0.019231", quoteDecimals: 6 })).toBe(
      "0.798552",
    );
    expect(orderMargin({ price: "4100", quantity: "0.01", markPrice: null, initialMarginRatio: "0.5", quoteDecimals: 6, buffer: "1" })).toBe("20.5");
    expect(notional("4071.45", "0.01")).toBe("40.7145");
  });
});
