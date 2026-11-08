import { describe, expect, it } from "vitest";
import { formatBps, formatCountdown, formatPct, formatPrice, formatScore, formatUptime, formatUsd, formatUsdSigned, shortHex } from "./format";

describe("format", () => {
  it("formats USD compactly from 1k with one fraction digit", () => {
    expect(formatUsd(999.4)).toBe("$999");
    expect(formatUsd(1234.5)).toBe("$1.2K");
    expect(formatUsd(25_400)).toBe("$25.4K");
    expect(formatUsd(3_250_000)).toBe("$3.3M");
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
    // Oracle prices arrive with up to 18 decimals; maxFraction truncates the string, no float rounding.
    expect(formatPrice("2230.5250740665452999", 4)).toBe("2,230.5250");
    expect(formatPrice("8.1", 4)).toBe("8.1");
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
