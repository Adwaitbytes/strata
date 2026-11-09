import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { OptionsBook, collateralFor, maxPayoutPerUnit, payoffPerUnit, type WriteRequest } from "./book.js";

const base: WriteRequest = {
  id: "w1",
  underlying: "US500",
  underlyingMarketId: "0x7b3bcf125dfa50ae8d44ecb60119ef5d52a627ad757b727850b0903b55e49b2c",
  kind: "call",
  strike: 100,
  expiryMs: 10_000,
  size: 2,
  premium: 3,
  openedAt: 0,
};

describe("payoff", () => {
  it("caps the call payoff at strike x callCapMultiple", () => {
    expect(maxPayoutPerUnit("call", 100, 1)).toBe(100);
    expect(payoffPerUnit("call", 100, 1, 130)).toBe(30);
    expect(payoffPerUnit("call", 100, 1, 90)).toBe(0);
    expect(payoffPerUnit("call", 100, 1, 500)).toBe(100);
    expect(payoffPerUnit("call", 100, 0.5, 500)).toBe(50);
  });

  it("pays at most the strike on a put", () => {
    expect(maxPayoutPerUnit("put", 100, 1)).toBe(100);
    expect(payoffPerUnit("put", 100, 1, 70)).toBe(30);
    expect(payoffPerUnit("put", 100, 1, 120)).toBe(0);
    expect(payoffPerUnit("put", 100, 1, 0)).toBe(100);
  });

  it("locks size x max payout as collateral", () => {
    expect(collateralFor("call", 100, 2, 1)).toBe(200);
    expect(collateralFor("put", 80, 0.5, 1)).toBe(40);
  });
});

describe("OptionsBook", () => {
  it("locks collateral and credits premium on a write", () => {
    const book = new OptionsBook({ cashUsd: 1000, callCapMultiple: 1 });
    const r = book.write(base);
    expect(r.ok).toBe(true);
    expect(book.lockedCollateralUsd()).toBe(200);
    expect(book.freeCashUsd()).toBe(1000 - 200 + 3);
    expect(book.premiumCollectedUsd()).toBe(3);
  });

  it("rejects a write whose collateral exceeds free cash (never naked)", () => {
    const book = new OptionsBook({ cashUsd: 150, callCapMultiple: 1 });
    const r = book.write(base);
    expect(r).toEqual({ ok: false, reason: "insufficient_collateral", requiredUsd: 200, freeUsd: 150 });
    expect(book.open()).toHaveLength(0);
  });

  it("settles a call in the money: writer pays the payoff from collateral", () => {
    const book = new OptionsBook({ cashUsd: 1000, callCapMultiple: 1 });
    book.write(base);
    const s = book.settle("w1", { price: 112, timestampMs: 10_000 }, 10_001);
    expect(s.payoutUsd).toBe(24);
    expect(s.writerPnlUsd).toBe(3 - 24);
    expect(s.settledOnStaleOracle).toBe(false);
    expect(book.lockedCollateralUsd()).toBe(0);
    expect(book.freeCashUsd()).toBe(1000 + 3 - 24);
    expect(book.realizedPnlUsd()).toBe(-21);
  });

  it("flags settlement on a report older than expiry", () => {
    const book = new OptionsBook({ cashUsd: 1000, callCapMultiple: 1 });
    book.write(base);
    expect(book.settle("w1", { price: 90, timestampMs: 9_000 }, 20_000).settledOnStaleOracle).toBe(true);
  });

  it("refuses to settle before expiry", () => {
    const book = new OptionsBook({ cashUsd: 1000, callCapMultiple: 1 });
    book.write(base);
    expect(() => book.settle("w1", { price: 90, timestampMs: 9_000 }, 9_999)).toThrow(/before expiry/);
  });

  it("closes early by paying the buyback price, capped at collateral", () => {
    const book = new OptionsBook({ cashUsd: 1000, callCapMultiple: 1 });
    book.write(base);
    const c = book.closeEarly("w1", 5, 100);
    expect(c.payoutUsd).toBe(10);
    expect(book.freeCashUsd()).toBe(1000 + 3 - 10);
  });

  it("restores from persisted positions", () => {
    const book = new OptionsBook({ cashUsd: 1000, callCapMultiple: 1 });
    book.write(base);
    book.write({ ...base, id: "w2", kind: "put", strike: 90 });
    book.settle("w2", { price: 95, timestampMs: 10_000 }, 10_000);
    const copy = OptionsBook.restore({ cashUsd: 1000, callCapMultiple: 1 }, book.all());
    expect(copy.freeCashUsd()).toBe(book.freeCashUsd());
    expect(copy.lockedCollateralUsd()).toBe(book.lockedCollateralUsd());
    expect(copy.realizedPnlUsd()).toBe(book.realizedPnlUsd());
  });
});

type Op =
  | { t: "write"; kind: "call" | "put"; strike: number; size: number; premium: number }
  | { t: "settle"; idx: number; price: number }
  | { t: "close"; idx: number; perUnit: number };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.record({
    t: fc.constant("write" as const),
    kind: fc.constantFrom<"call" | "put">("call", "put"),
    strike: fc.double({ min: 0.01, max: 50_000, noNaN: true }),
    size: fc.double({ min: 0.0001, max: 100, noNaN: true }),
    premium: fc.double({ min: 0, max: 500, noNaN: true }),
  }),
  fc.record({ t: fc.constant("settle" as const), idx: fc.nat(50), price: fc.double({ min: 0, max: 1e6, noNaN: true }) }),
  fc.record({ t: fc.constant("close" as const), idx: fc.nat(50), perUnit: fc.double({ min: 0, max: 1e6, noNaN: true }) }),
);

describe("full-collateral invariant (property)", () => {
  it("no position ever owes more than its collateral and free cash never goes negative", () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1e6, noNaN: true }), fc.double({ min: 0.1, max: 2, noNaN: true }), fc.array(opArb, { maxLength: 60 }), (cash, cap, ops) => {
        const book = new OptionsBook({ cashUsd: cash, callCapMultiple: cap });
        let n = 0;
        for (const op of ops) {
          if (op.t === "write") {
            const before = book.freeCashUsd();
            const need = collateralFor(op.kind, op.strike, op.size, cap);
            const r = book.write({ ...base, id: `p${n++}`, kind: op.kind, strike: op.strike, size: op.size, premium: op.premium });
            expect(r.ok).toBe(need <= before);
          } else {
            const open = book.open();
            const pos = open[op.idx % Math.max(open.length, 1)];
            if (pos === undefined) continue;
            const res = op.t === "settle" ? book.settle(pos.id, { price: op.price, timestampMs: pos.expiryMs }, pos.expiryMs) : book.closeEarly(pos.id, op.perUnit, 1);
            expect(res.payoutUsd).toBeLessThanOrEqual(pos.collateralUsd + 1e-9);
            expect(res.payoutUsd).toBeGreaterThanOrEqual(0);
          }
          for (const p of book.open()) expect(p.collateralUsd).toBeCloseTo(p.size * maxPayoutPerUnit(p.kind, p.strike, cap), 6);
          expect(book.freeCashUsd()).toBeGreaterThanOrEqual(-1e-6);
          const locked = book.open().reduce((s, p) => s + p.collateralUsd, 0);
          expect(book.lockedCollateralUsd()).toBeCloseTo(locked, 4);
          expect(book.worstCaseLiabilityUsd()).toBeLessThanOrEqual(book.lockedCollateralUsd() + 1e-6);
        }
      }),
      { numRuns: 300 },
    );
  });
});
