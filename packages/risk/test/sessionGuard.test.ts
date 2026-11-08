import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { DEFAULT_PARAMS, type RiskParams } from "../src/params.js";
import {
  CALENDAR,
  evaluateSession,
  sessionClassFor,
  tradingIntervals,
  zonedTimeToUtc,
  type SessionClass,
} from "../src/sessionGuard.js";

const P = DEFAULT_PARAMS;
const OFF_HOURS: RiskParams = { ...P, offHoursQuoting: true };
/** New York wall-clock to UTC ms. */
const ny = (date: string, time: string) => {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const [hh, mm, ss = 0] = time.split(":").map(Number) as [number, number, number?];
  return zonedTimeToUtc(y, m, d, hh, mm, ss);
};
const ev = (cls: SessionClass, date: string, time: string, params: RiskParams = P) => evaluateSession(cls, ny(date, time), params);

describe("time zone conversion", () => {
  it("handles EST and EDT", () => {
    expect(new Date(ny("2026-11-09", "09:30")).toISOString()).toBe("2026-11-09T14:30:00.000Z");
    expect(new Date(ny("2026-07-06", "09:30")).toISOString()).toBe("2026-07-06T13:30:00.000Z");
  });
});

describe("asset class mapping", () => {
  it("maps asset classes to calendars", () => {
    expect(sessionClassFor("equity")).toBe("us_equity");
    expect(sessionClassFor("index")).toBe("us_equity");
    expect(sessionClassFor("fx")).toBe("fx");
    expect(sessionClassFor("commodity")).toBe("cme_globex");
    expect(sessionClassFor("crypto")).toBe("always_open");
    expect(sessionClassFor("compute")).toBe("always_open");
  });
});

describe("calendar data", () => {
  it("cites a source for every class", () => {
    for (const c of Object.values(CALENDAR.classes)) expect(c.sources.length).toBeGreaterThan(0);
  });
  it("generates the regular NYSE session", () => {
    const iv = tradingIntervals("us_equity", ny("2026-11-09", "00:00"), ny("2026-11-09", "23:59"));
    expect(iv).toContainEqual({ openMs: ny("2026-11-09", "09:30"), closeMs: ny("2026-11-09", "16:00") });
  });
  it("returns no intervals for always-open markets", () => {
    expect(tradingIntervals("always_open", 0, 1e12)).toEqual([]);
  });
});

describe("US equities", () => {
  it("is open mid-session with neutral multipliers", () => {
    const s = ev("us_equity", "2026-11-09", "11:00");
    expect(s).toMatchObject({ state: "open", quote: true, flatten: false, decision: null });
    expect(s.multipliers).toEqual({ spreadMultiplier: 1, sizeMultiplier: 1, inventoryCapMultiplier: 1 });
  });

  it("widens x2 and halves size 30 minutes before close (market close fixture)", () => {
    const s = ev("us_equity", "2026-11-09", "15:40");
    expect(s.state).toBe("closing");
    expect(s.multipliers.spreadMultiplier).toBe(2);
    expect(s.multipliers.sizeMultiplier).toBe(0.5);
    expect(s.flatten).toBe(false);
    expect(s.decision).toMatchObject({ guard: "session", action: "widen", reason: "session_pre_close" });
  });

  it("flattens 5 minutes before close", () => {
    const s = ev("us_equity", "2026-11-09", "15:56");
    expect(s).toMatchObject({ state: "closing", flatten: true, quote: true });
    expect(s.decision).toMatchObject({ action: "flatten", reason: "session_flatten" });
  });

  it("does not quote after close unless offHoursQuoting", () => {
    const s = ev("us_equity", "2026-11-09", "16:30");
    expect(s).toMatchObject({ state: "closed", quote: false });
    expect(s.decision).toMatchObject({ action: "halt", reason: "session_closed" });
  });

  it("quotes off hours at 4x spread, tiny size and 10% cap when enabled", () => {
    const s = ev("us_equity", "2026-11-09", "20:00", OFF_HOURS);
    expect(s).toMatchObject({ state: "closed", quote: true });
    expect(s.multipliers).toEqual({ spreadMultiplier: 4, sizeMultiplier: 0.1, inventoryCapMultiplier: 0.1 });
    expect(s.decision).toMatchObject({ action: "widen", reason: "session_closed" });
  });

  it("is closed on weekends (weekend fixture)", () => {
    expect(ev("us_equity", "2026-11-07", "12:00").state).toBe("closed");
    expect(ev("us_equity", "2026-11-08", "12:00").state).toBe("closed");
  });

  it("is closed on NYSE holidays and closes early on early-close days", () => {
    expect(ev("us_equity", "2026-11-26", "12:00").state).toBe("closed");
    expect(ev("us_equity", "2026-07-03", "12:00").state).toBe("closed");
    expect(ev("us_equity", "2026-11-27", "12:45").state).toBe("closing");
    expect(ev("us_equity", "2026-11-27", "12:56").flatten).toBe(true);
    expect(ev("us_equity", "2026-11-27", "13:30").state).toBe("closed");
  });

  it("waits the reopen cooldown, then ramps size over 10 minutes (reopen gap fixture)", () => {
    const cooldown = ev("us_equity", "2026-11-09", "09:31:00");
    expect(cooldown).toMatchObject({ state: "reopening", quote: false });
    expect(cooldown.decision).toMatchObject({ action: "halt", reason: "session_reopen_cooldown" });

    const ramp = ev("us_equity", "2026-11-09", "09:35:00"); // 300 s after open: 180 s into a 600 s ramp
    expect(ramp).toMatchObject({ state: "reopening", quote: true });
    expect(ramp.multipliers.sizeMultiplier).toBeCloseTo(0.1 + 0.9 * 0.3, 10);
    expect(ramp.multipliers.spreadMultiplier).toBeCloseTo(2 - 0.3, 10);
    expect(ramp.decision).toMatchObject({ action: "reduce", reason: "session_ramp" });

    expect(ev("us_equity", "2026-11-09", "09:42:01").state).toBe("open");
  });

  it("handles daylight saving time", () => {
    expect(ev("us_equity", "2026-07-06", "09:29").state).toBe("closed");
    expect(ev("us_equity", "2026-07-06", "12:00").state).toBe("open");
  });

  it("reports next close and last open", () => {
    const s = ev("us_equity", "2026-11-09", "11:00");
    expect(s.nextCloseMs).toBe(ny("2026-11-09", "16:00"));
    expect(s.lastOpenMs).toBe(ny("2026-11-09", "09:30"));
  });
});

describe("FX weekly session", () => {
  it("is open midweek and closed on Saturday", () => {
    expect(ev("fx", "2026-11-11", "03:00").state).toBe("open");
    expect(ev("fx", "2026-11-07", "12:00").state).toBe("closed");
  });
  it("reopens Sunday 17:00 New York with cooldown", () => {
    expect(ev("fx", "2026-11-08", "16:59").state).toBe("closed");
    expect(ev("fx", "2026-11-08", "17:01")).toMatchObject({ state: "reopening", quote: false });
  });
  it("closes Friday 17:00 New York", () => {
    expect(ev("fx", "2026-11-13", "16:40").state).toBe("closing");
    expect(ev("fx", "2026-11-13", "17:10").state).toBe("closed");
  });
  it("is closed on Christmas", () => {
    expect(ev("fx", "2026-12-25", "12:00").state).toBe("closed");
    expect(ev("fx", "2026-12-24", "16:40").state).toBe("closing");
  });
});

describe("CME Globex metals and energy", () => {
  it("takes the daily 17:00 to 18:00 break", () => {
    expect(ev("cme_globex", "2026-11-10", "12:00").state).toBe("open");
    expect(ev("cme_globex", "2026-11-10", "17:30").state).toBe("closed");
    expect(ev("cme_globex", "2026-11-10", "18:01").state).toBe("reopening");
  });
  it("is closed over the weekend and reopens Sunday 18:00", () => {
    expect(ev("cme_globex", "2026-11-14", "12:00").state).toBe("closed");
    expect(ev("cme_globex", "2026-11-15", "17:59").state).toBe("closed");
    expect(ev("cme_globex", "2026-11-15", "18:05").state).toBe("reopening");
    expect(ev("cme_globex", "2026-11-15", "18:30").state).toBe("open");
  });
  it("is closed on Good Friday and halts early on US holidays", () => {
    expect(ev("cme_globex", "2026-04-03", "12:00").state).toBe("closed");
    expect(ev("cme_globex", "2026-11-26", "12:40").state).toBe("closing");
    expect(ev("cme_globex", "2026-11-26", "14:00").state).toBe("closed");
  });
});

describe("calendar validity (L-5)", () => {
  it("fails closed for session-bound markets after validUntil, even with offHoursQuoting", () => {
    expect(CALENDAR.validUntil).toBe("2027-12-31");
    for (const cls of ["us_equity", "fx", "cme_globex"] as const) {
      const s = ev(cls, "2028-01-05", "12:00", OFF_HOURS);
      expect(s).toMatchObject({ state: "closed", quote: false, flatten: false });
      expect(s.decision).toMatchObject({ action: "halt", reason: "session_closed", observed: { calendarValidUntil: "2027-12-31" } });
      expect(s.decision!.detail).toMatch(/calendar/i);
    }
  });
  it("keeps always-open markets running", () => {
    expect(ev("always_open", "2028-01-05", "12:00").state).toBe("always_open");
  });
  it("flattens before the calendar runs out", () => {
    expect(ev("fx", "2027-12-31", "16:57").flatten).toBe(true);
    expect(ev("us_equity", "2027-12-31", "12:00").state).toBe("open");
    expect(ev("us_equity", "2027-12-24", "12:00").state).toBe("closed");
    expect(ev("us_equity", "2027-11-26", "13:30").state).toBe("closed");
  });
});

describe("always-open markets", () => {
  it("is always_open with neutral multipliers", () => {
    const s = ev("always_open", "2026-11-07", "03:00");
    expect(s).toMatchObject({ state: "always_open", quote: true, flatten: false, decision: null, nextCloseMs: null });
  });
});

describe("properties", () => {
  const classes: SessionClass[] = ["us_equity", "fx", "cme_globex", "always_open"];
  const start = Date.UTC(2026, 0, 1);
  const end = Date.UTC(2027, 11, 30);

  it("multipliers stay within configured bounds and flatten implies closing", () => {
    fc.assert(
      fc.property(fc.constantFrom(...classes), fc.integer({ min: start, max: end }), fc.boolean(), (cls, t, off) => {
        const s = evaluateSession(cls, t, { ...P, offHoursQuoting: off });
        expect(s.multipliers.spreadMultiplier).toBeGreaterThanOrEqual(1);
        expect(s.multipliers.spreadMultiplier).toBeLessThanOrEqual(P.offHoursSpreadMultiplier);
        expect(s.multipliers.sizeMultiplier).toBeGreaterThan(0);
        expect(s.multipliers.sizeMultiplier).toBeLessThanOrEqual(1);
        if (s.flatten) expect(s.state).toBe("closing");
        if (s.state === "closed" && !off) expect(s.quote).toBe(false);
      }),
      { numRuns: 500 },
    );
  });

  it("intervals are ordered and non-overlapping", () => {
    for (const cls of ["us_equity", "fx", "cme_globex"] as const) {
      const iv = tradingIntervals(cls, start, end);
      expect(iv.length).toBeGreaterThan(50);
      for (let i = 0; i < iv.length; i++) {
        expect(iv[i]!.openMs).toBeLessThan(iv[i]!.closeMs);
        if (i > 0) expect(iv[i]!.openMs).toBeGreaterThan(iv[i - 1]!.closeMs);
      }
    }
  });
});
