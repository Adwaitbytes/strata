"use client";

import { AlertTriangle, Inbox, RotateCw } from "lucide-react";
import type { ReactNode } from "react";
import { describeError } from "@/lib/api/client";
import { cn } from "@/lib/utils";

export function ErrorState({ error, onRetry, className, compact }: { error: unknown; onRetry?: () => void; className?: string; compact?: boolean }) {
  const { title, detail } = describeError(error);
  return (
    <div role="alert" className={cn("flex flex-col items-start gap-3 rounded-md border border-dashed border-border-strong px-5", compact ? "py-4" : "py-8", className)}>
      <div className="flex items-center gap-2 text-sm font-medium text-fg">
        <AlertTriangle className="size-4 text-warn" aria-hidden />
        {title}
      </div>
      <p className="max-w-prose text-sm text-fg-muted">{detail}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-border-strong px-3 text-sm text-fg transition-colors hover:bg-surface-hover"
        >
          <RotateCw className="size-3.5" aria-hidden /> Retry
        </button>
      ) : null}
    </div>
  );
}

export function EmptyState({ title, detail, action, className }: { title: string; detail: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-start gap-2 rounded-md border border-dashed border-border-strong px-5 py-8", className)}>
      <div className="flex items-center gap-2 text-sm font-medium text-fg">
        <Inbox className="size-4 text-fg-subtle" aria-hidden />
        {title}
      </div>
      <div className="max-w-prose text-sm text-fg-muted">{detail}</div>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
