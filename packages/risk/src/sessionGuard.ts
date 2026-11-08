/**
 * Session Guard (PRD 9.5, the weekend-gap lesson). Pure: the session phase is derived from the
 * committed market-hours calendar (`data/calendar.json`, sources cited inside) and the time passed in.
 * Callers pass CHAIN time so the agent and the guard agree on "now".
 *
 * - 30 min before close: spread x2, size x0.5 (state `closing`).
 * - 5 min before close: flatten inventory (state `closing`, flatten = true).
 * - Closed: no quotes, unless offHoursQuoting, then 4x spread, tiny size, 10% inventory cap.
 * - After open: no quotes for reopenCooldownSec, then size ramps up over rampMinutes (state `reopening`).
 */
import { z } from "zod";
import type { AssetClass, SessionState } from "@strata/sdk";
import type { GuardDecision } from "./decisions.js";
import type { RiskParams } from "./params.js";
import type { SessionMultipliers } from "./quoting.js";
import calendarJson from "./data/calendar.json" with { type: "json" };

const HHMM = z.string().regex(/^\d{2}:\d{2}$/);
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Source = z.object({ url: z.string().url(), retrieved: DATE, note: z.string() });
const Weekday = z.number().int().min(0).max(6);

const CalendarSchema = z.object({
  version: z.literal(1),
  timezone: z.string(),
  /** Last New York date the holiday lists cover. Later dates fail closed. */
  validUntil: DATE,
  classes: z.object({
    us_equity: z.object({
      kind: z.literal("daily"),
      open: HHMM,
      close: HHMM,
      weekdays: z.array(Weekday),
      holidays: z.array(DATE),
      earlyCloses: z.record(DATE, HHMM),
      sources: z.array(Source).min(1),
    }),
    fx: z.object({
      kind: z.literal("weekly"),
      openDay: Weekday,
      openTime: HHMM,
      closeDay: Weekday,
      closeTime: HHMM,
      holidays: z.array(DATE),
      sources: z.array(Source).min(1),
    }),
    cme_globex: z.object({
      kind: z.literal("globex"),
      openTime: HHMM,
      closeTime: HHMM,
      tradeDays: z.array(Weekday),
      holidays: z.array(DATE),
      conservativeEarlyHalts: z.record(DATE, HHMM),
      sources: z.array(Source).min(1),
    }),
    always_open: z.object({ kind: z.literal("always"), sources: z.array(Source).min(1) }),
  }),
});
export type MarketCalendar = z.infer<typeof CalendarSchema>;

export const CALENDAR: MarketCalendar = CalendarSchema.parse(calendarJson);

export type SessionClass = keyof MarketCalendar["classes"];

export function sessionClassFor(assetClass: AssetClass): SessionClass {
  switch (assetClass) {
    case "equity":
    case "index":
      return "us_equity";
    case "fx":
      return "fx";
    case "commodity":
      return "cme_globex";
    case "crypto":
    case "compute":
      return "always_open";
  }
}

/* ------------------------------ time zone helpers ------------------------------ */

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (f === undefined) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Offset (local wall clock minus UTC) at instant `ms`. */
function tzOffsetMs(ms: number, timeZone: string): number {
  const parts: Record<string, number> = {};
  for (const p of formatter(timeZone).formatToParts(new Date(ms))) {
    if (p.type !== "literal") parts[p.type] = Number(p.value);
  }
  const asUtc = Date.UTC(parts["year"]!, parts["month"]! - 1, parts["day"]!, parts["hour"]!, parts["minute"]!, parts["second"]!);
  return asUtc - Math.floor(ms / 1_000) * 1_000;
}

/** Wall-clock time in `timeZone` (default New York) to UTC ms. */
export function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second = 0,
  timeZone: string = CALENDAR.timezone,
): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  const first = guess - tzOffsetMs(guess, timeZone);
  return guess - tzOffsetMs(first, timeZone);
}

interface CivilDate {
  readonly y: number;
  readonly m: number;
  readonly d: number;
  readonly weekday: number;
  readonly iso: string;
}

function civil(y: number, m: number, d: number): CivilDate {
  const t = new Date(Date.UTC(y, m - 1, d));
  return {
    y: t.getUTCFullYear(),
    m: t.getUTCMonth() + 1,
    d: t.getUTCDate(),
    weekday: t.getUTCDay(),
    iso: t.toISOString().slice(0, 10),
  };
}

function addDays(c: CivilDate, n: number): CivilDate {
  return civil(c.y, c.m, c.d + n);
}

function at(c: CivilDate, hhmm: string): number {
  const [h, mi] = hhmm.split(":").map(Number) as [number, number];
  return zonedTimeToUtc(c.y, c.m, c.d, h, mi);
}

function civilDatesBetween(fromMs: number, toMs: number): CivilDate[] {
  const pad = 8 * 86_400_000;
  const start = new Date(fromMs - pad);
  const out: CivilDate[] = [];
  let c = civil(start.getUTCFullYear(), start.getUTCMonth() + 1, start.getUTCDate());
  const endMs = toMs + pad;
  while (Date.UTC(c.y, c.m - 1, c.d) <= endMs) {
    out.push(c);
    c = addDays(c, 1);
  }
  return out;
}

/* ------------------------------ intervals ------------------------------ */

export interface Interval {
  readonly openMs: number;
  readonly closeMs: number;
}

function subtract(intervals: readonly Interval[], holes: readonly Interval[]): Interval[] {
  let out = [...intervals];
  for (const h of holes) {
    const next: Interval[] = [];
    for (const iv of out) {
      if (h.closeMs <= iv.openMs || h.openMs >= iv.closeMs) {
        next.push(iv);
        continue;
      }
      if (h.openMs > iv.openMs) next.push({ openMs: iv.openMs, closeMs: h.openMs });
      if (h.closeMs < iv.closeMs) next.push({ openMs: h.closeMs, closeMs: iv.closeMs });
    }
    out = next;
  }
  return out;
}

/** Trading intervals overlapping [fromMs, toMs], sorted by open time. */
/** First instant after the calendar's coverage (midnight New York after validUntil). */
export function calendarEndMs(calendar: MarketCalendar = CALENDAR): number {
  const [y, m, d] = calendar.validUntil.split("-").map(Number) as [number, number, number];
  return at(addDays(civil(y, m, d), 1), "00:00");
}

export function tradingIntervals(cls: SessionClass, fromMs: number, toMs: number, calendar: MarketCalendar = CALENDAR): Interval[] {
  const validEnd = calendarEndMs(calendar);
  const dates = civilDatesBetween(fromMs, toMs);
  let out: Interval[] = [];
  switch (cls) {
    case "always_open":
      return [];
    case "us_equity": {
      const c = calendar.classes.us_equity;
      for (const d of dates) {
        if (!c.weekdays.includes(d.weekday) || c.holidays.includes(d.iso)) continue;
        out.push({ openMs: at(d, c.open), closeMs: at(d, c.earlyCloses[d.iso] ?? c.close) });
      }
      break;
    }
    case "fx": {
      const c = calendar.classes.fx;
      const span = (c.closeDay - c.openDay + 7) % 7;
      for (const d of dates) {
        if (d.weekday !== c.openDay) continue;
        out.push({ openMs: at(d, c.openTime), closeMs: at(addDays(d, span), c.closeTime) });
      }
      const holes = c.holidays.map((iso) => {
        const [y, m, dd] = iso.split("-").map(Number) as [number, number, number];
        const h = civil(y, m, dd);
        return { openMs: at(addDays(h, -1), c.closeTime), closeMs: at(h, c.closeTime) };
      });
      out = subtract(out, holes);
      break;
    }
    case "cme_globex": {
      const c = calendar.classes.cme_globex;
      for (const d of dates) {
        if (!c.tradeDays.includes(d.weekday) || c.holidays.includes(d.iso)) continue;
        out.push({ openMs: at(addDays(d, -1), c.openTime), closeMs: at(d, c.conservativeEarlyHalts[d.iso] ?? c.closeTime) });
      }
      break;
    }
  }
  return out
    .map((iv) => ({ openMs: iv.openMs, closeMs: Math.min(iv.closeMs, validEnd) }))
    .filter((iv) => iv.closeMs > iv.openMs && iv.closeMs >= fromMs && iv.openMs <= toMs)
    .sort((a, b) => a.openMs - b.openMs);
}

/* ------------------------------ evaluation ------------------------------ */

export interface SessionEvaluation {
  readonly state: SessionState;
  /** False means cancel everything and do not quote. */
  readonly quote: boolean;
  /** True means quote only a reduce-only order that takes inventory to zero. */
  readonly flatten: boolean;
  readonly multipliers: SessionMultipliers;
  readonly decision: GuardDecision | null;
  readonly nextCloseMs: number | null;
  readonly lastOpenMs: number | null;
}

const NEUTRAL: SessionMultipliers = { spreadMultiplier: 1, sizeMultiplier: 1, inventoryCapMultiplier: 1 };
const LOOKAHEAD_MS = 10 * 86_400_000;

function decision(action: GuardDecision["action"], reason: GuardDecision["reason"], detail: string, observed: GuardDecision["observed"]): GuardDecision {
  return { guard: "session", action, reason, detail, observed };
}

export function evaluateSession(cls: SessionClass, nowMs: number, params: RiskParams, calendar: MarketCalendar = CALENDAR): SessionEvaluation {
  if (cls === "always_open") {
    return { state: "always_open", quote: true, flatten: false, multipliers: NEUTRAL, decision: null, nextCloseMs: null, lastOpenMs: null };
  }
  if (nowMs >= calendarEndMs(calendar)) {
    return {
      state: "closed",
      quote: false,
      flatten: false,
      multipliers: NEUTRAL,
      nextCloseMs: null,
      lastOpenMs: null,
      decision: decision("halt", "session_closed", "Market-hours calendar has expired; quoting stops until it is updated.", {
        sessionClass: cls,
        calendarValidUntil: calendar.validUntil,
      }),
    };
  }
  const intervals = tradingIntervals(cls, nowMs - LOOKAHEAD_MS, nowMs + LOOKAHEAD_MS, calendar);
  const current = intervals.find((iv) => iv.openMs <= nowMs && nowMs < iv.closeMs);

  if (current === undefined) {
    const next = intervals.find((iv) => iv.openMs > nowMs);
    const prev = [...intervals].reverse().find((iv) => iv.closeMs <= nowMs);
    const base = { state: "closed" as const, flatten: false, nextCloseMs: next?.closeMs ?? null, lastOpenMs: prev?.openMs ?? null };
    const observed = { sessionClass: cls, nextOpenMs: next?.openMs ?? -1 };
    if (params.offHoursQuoting) {
      return {
        ...base,
        quote: true,
        multipliers: {
          spreadMultiplier: params.offHoursSpreadMultiplier,
          sizeMultiplier: params.offHoursSizeMultiplier,
          inventoryCapMultiplier: params.offHoursInventoryCapFraction,
        },
        decision: decision("widen", "session_closed", "Underlying market is closed; quoting off-hours at wide spread and small size.", observed),
      };
    }
    return {
      ...base,
      quote: false,
      multipliers: NEUTRAL,
      decision: decision("halt", "session_closed", "Underlying market is closed; quotes are pulled until it reopens.", observed),
    };
  }

  const toCloseSec = (current.closeMs - nowMs) / 1_000;
  const sinceOpenSec = (nowMs - current.openMs) / 1_000;
  const base = { nextCloseMs: current.closeMs, lastOpenMs: current.openMs };

  if (toCloseSec <= params.preCloseFlattenMin * 60) {
    return {
      ...base,
      state: "closing",
      quote: true,
      flatten: true,
      multipliers: { spreadMultiplier: params.preCloseSpreadMultiplier, sizeMultiplier: params.preCloseSizeMultiplier, inventoryCapMultiplier: 1 },
      decision: decision("flatten", "session_flatten", `Underlying closes in ${Math.ceil(toCloseSec / 60)} min; flattening inventory.`, {
        minutesToClose: Math.round((toCloseSec / 60) * 100) / 100,
        limitMin: params.preCloseFlattenMin,
      }),
    };
  }

  if (sinceOpenSec < params.reopenCooldownSec) {
    return {
      ...base,
      state: "reopening",
      quote: false,
      flatten: false,
      multipliers: NEUTRAL,
      decision: decision("halt", "session_reopen_cooldown", "Underlying just reopened; waiting for oracle and book to settle.", {
        secondsSinceOpen: Math.round(sinceOpenSec),
        cooldownSec: params.reopenCooldownSec,
      }),
    };
  }

  const rampSec = params.rampMinutes * 60;
  const rampElapsed = sinceOpenSec - params.reopenCooldownSec;
  const inRamp = rampElapsed < rampSec;
  const progress = inRamp ? rampElapsed / rampSec : 1;
  const rampSize = params.rampStartSizeFraction + (1 - params.rampStartSizeFraction) * progress;
  const rampSpread = params.preCloseSpreadMultiplier - (params.preCloseSpreadMultiplier - 1) * progress;
  const closing = toCloseSec <= params.preCloseWidenMin * 60;

  if (closing) {
    return {
      ...base,
      state: "closing",
      quote: true,
      flatten: false,
      multipliers: {
        spreadMultiplier: Math.max(params.preCloseSpreadMultiplier, rampSpread),
        sizeMultiplier: params.preCloseSizeMultiplier * rampSize,
        inventoryCapMultiplier: 1,
      },
      decision: decision("widen", "session_pre_close", `Underlying closes in ${Math.ceil(toCloseSec / 60)} min; spreads widened and size cut.`, {
        minutesToClose: Math.round((toCloseSec / 60) * 100) / 100,
        limitMin: params.preCloseWidenMin,
      }),
    };
  }

  if (inRamp) {
    return {
      ...base,
      state: "reopening",
      quote: true,
      flatten: false,
      multipliers: { spreadMultiplier: rampSpread, sizeMultiplier: rampSize, inventoryCapMultiplier: 1 },
      decision: decision("reduce", "session_ramp", "Underlying reopened; size is ramping back to normal.", {
        rampProgress: Math.round(progress * 1_000) / 1_000,
        rampMinutes: params.rampMinutes,
      }),
    };
  }

  return { ...base, state: "open", quote: true, flatten: false, multipliers: NEUTRAL, decision: null };
}
