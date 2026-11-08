"use client";

import { InfoTip } from "@/components/data/info-tip";
import { useNow } from "@/hooks/use-now";
import { formatCountdown, formatUtc } from "@/lib/format";

export function SeasonTimer({ season, endsAt }: { season: number; endsAt: number | null }) {
  const now = useNow();
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[13px] text-fg-muted">
        <InfoTip metric="seasonTimer">{`Season ${season} ends in`}</InfoTip>
      </div>
      <div className="num text-[22px] font-medium leading-none text-fg" title={endsAt ? formatUtc(endsAt) : undefined}>
        {endsAt == null ? "Not scheduled" : now == null ? "--:--:--" : formatCountdown(endsAt - now)}
      </div>
    </div>
  );
}
