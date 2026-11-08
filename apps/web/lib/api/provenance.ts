import { assertNotMockInProduction, type Provenance } from "@strata/sdk";

/**
 * Walks a validated response and enforces the MOCK rule on every `provenance` field it finds.
 * Responses are small (tens of KB), so a full walk is cheap and catches nested samples too.
 */
export function assertNoMockDeep(value: unknown, env: string | undefined): void {
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const node = stack.pop();
    if (Array.isArray(node)) {
      for (const item of node) stack.push(item);
    } else if (node !== null && typeof node === "object") {
      for (const [key, child] of Object.entries(node)) {
        if (key === "provenance" && typeof child === "string") assertNotMockInProduction(child, env);
        else if (typeof child === "object") stack.push(child);
      }
    }
  }
}

/** True when any nested provenance is MOCK. Drives the visible MOCK banner in development. */
export function containsMock(value: unknown): boolean {
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const node = stack.pop();
    if (Array.isArray(node)) stack.push(...node);
    else if (node !== null && typeof node === "object") {
      for (const [key, child] of Object.entries(node)) {
        if (key === "provenance" && child === "MOCK") return true;
        if (typeof child === "object") stack.push(child);
      }
    }
  }
  return false;
}

/** The most cautious label among samples: anything non-LIVE wins so the badge never undersells. */
export function dominantProvenance(values: readonly Provenance[]): Provenance {
  const order: Provenance[] = ["MOCK", "SIMULATED", "BACKTEST", "BASELINE", "TESTNET", "LIVE"];
  for (const p of order) if (values.includes(p)) return p;
  return "LIVE";
}
