import type { AgentStatus } from "@strata/sdk";
import { cn } from "@/lib/utils";

const STYLE: Record<AgentStatus, { label: string; dot: string; text: string }> = {
  active: { label: "Quoting", dot: "bg-bid", text: "text-fg" },
  halted: { label: "Halted", dot: "bg-warn", text: "text-warn" },
  suspended: { label: "Suspended", dot: "bg-halt", text: "text-halt" },
  withdrawn: { label: "Withdrawn", dot: "bg-fg-subtle", text: "text-fg-muted" },
  pending: { label: "Pending", dot: "bg-fg-subtle", text: "text-fg-muted" },
};

export function StatusPill({ status, className }: { status: AgentStatus; className?: string }) {
  const s = STYLE[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[13px]", s.text, className)}>
      <span aria-hidden className={cn("size-1.5 rounded-full", s.dot)} />
      {s.label}
    </span>
  );
}
