import { ArrowDown, ArrowUp } from "lucide-react";

export function RankDelta({ rank, previous }: { rank: number; previous: number | null }) {
  if (previous == null || previous === rank) return <span className="sr-only">No change</span>;
  const up = previous > rank;
  const n = Math.abs(previous - rank);
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] num ${up ? "text-bid" : "text-ask"}`}>
      {up ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden />}
      {n}
      <span className="sr-only">{up ? `up ${n}` : `down ${n}`} since last epoch</span>
    </span>
  );
}
