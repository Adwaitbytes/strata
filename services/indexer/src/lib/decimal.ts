/**
 * Exact decimal handling for chain-precision values. Values are bigint fixed-point at 18
 * decimals so prices that reach the DB as `numeric` never pass through a JS float.
 */
export const SCALE = 18;
const TEN = 10n;
const ONE = TEN ** BigInt(SCALE);

/** Parse "71200", "-1.5", "1.2e-05" into a bigint scaled by 10^18 (truncates beyond 18 dp). */
export function toFixed18(value: string): bigint {
  const m = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(value.trim());
  if (!m || (m[2] === "" && (m[3] ?? "") === "")) throw new Error(`not a decimal: ${value}`);
  const sign = m[1] === "-" ? -1n : 1n;
  const intPart = m[2] ?? "";
  const frac = m[3] ?? "";
  const exp = Number(m[4] ?? "0");
  const digits = BigInt((intPart + frac).replace(/^0+(?=\d)/, "") || "0");
  const shift = SCALE + exp - frac.length;
  const scaled = shift >= 0 ? digits * TEN ** BigInt(shift) : digits / TEN ** BigInt(-shift);
  return sign * scaled;
}

export function fromFixed18(value: bigint): string {
  const neg = value < 0n;
  const abs = neg ? -value : value;
  const int = abs / ONE;
  const frac = (abs % ONE).toString().padStart(SCALE, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${int.toString()}${frac ? `.${frac}` : ""}`;
}

/** Divide a fixed-18 value by 10^places (chain units to human units). */
export function shiftDown(value: bigint, places: number): bigint {
  return value / TEN ** BigInt(places);
}

export function toNumber(value: bigint): number {
  return Number(fromFixed18(value));
}

export function mulFixed(a: bigint, b: bigint): bigint {
  return (a * b) / ONE;
}
