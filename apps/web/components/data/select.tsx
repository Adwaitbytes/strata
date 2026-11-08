import { ChevronDown } from "lucide-react";
import type { SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** Native select (keeps platform a11y and mobile pickers) with the brand chevron. */
export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <span className={cn("relative inline-flex", className)}>
      <select
        {...props}
        className="h-9 w-full appearance-none rounded-lg border border-border-strong bg-bg-sunken pl-3 pr-9 text-sm text-fg transition-colors hover:border-fg-subtle focus-visible:outline-2 focus-visible:outline-focus"
      >
        {children}
      </select>
      <ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-fg-muted" />
    </span>
  );
}
