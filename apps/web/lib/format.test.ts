import { describe, expect, it } from "vitest";
import { formatBps, formatCountdown, formatPct, formatPrice, formatScore, formatUptime, formatUsd, formatUsdSigned, shortHex } from "./format";

describe("format", () => {
  it("formats USD compactly above 10k and exactly below", () => {
    expect(formatUsd(1234.5)).toBe("$1,235");
    expect(formatUsd(25_400)).toBe("$25.4K");
    expect(formatUsd(3_250_000)).toBe("$3.25M");
    expect(formatUsd(0)).toBe("$0");
  });

  it("formats signed USD with an explicit sign and a real minus", () => {
    expect(formatUsdSigned(12.34)).toBe("+$12.34");
    expect(formatUsdSigned(-5)).toBe("−$5.00");
    expect(formatUsdSigned(0)).toBe("$0.00");
  });

  it("formats bps with one decimal", () => {
    expect(formatBps(4.25)).toBe("4.3 bps");
    expect(formatBps(null)).toBe("n/a");
  });

  it("formats uptime from basis points", () => {
    expect(formatUptime(9_875)).toBe("98.75%");
    expect(formatUptime(10_000)).toBe("100.00%");
  });

  it("formats share as percent", () => {
    expect(formatPct(0.3125)).toBe("31.3%");
  });

  it("formats score as integer with grouping", () => {
    expect(formatScore(8_412)).toBe("8,412");
  });

  it("formats decimal-string prices without float drift", () => {
    expect(formatPrice("100.050")).toBe("100.050");
    expect(formatPrice("12345.5")).toBe("12,345.5");
    expect(formatPrice("-0.25")).toBe("−0.25");
  });

  it("formats countdowns", () => {
    expect(formatCountdown(0)).toBe("00:00:00");
    expect(formatCountdown(90_061_000)).toBe("1d 01:01:01");
    expect(formatCountdown(-5)).toBe("00:00:00");
  });

  it("shortens hex", () => {
    expect(shortHex("0x1234567890abcdef1234567890abcdef12345678")).toBe("0x1234…5678");
  });
});
