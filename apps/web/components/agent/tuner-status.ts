import type { TunerEvent } from "@strata/sdk";

export type TunerOutcome = "rejected" | "applied" | "suggested";

/**
 * Only a live-mode event can have changed the quoter. Older shadow rows were recorded with
 * `applied` filled in, so the mode, not the field, decides what the feed may call applied.
 */
export function tunerOutcome(e: TunerEvent): TunerOutcome {
  if (e.rejected) return "rejected";
  return e.mode === "live" && e.applied !== null ? "applied" : "suggested";
}
