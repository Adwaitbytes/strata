import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageHeader({
  title,
  description,
  meta,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-5 md:flex-row md:items-end md:justify-between", className)}>
      <div className="min-w-0">
        {meta ? <div className="mb-3 flex flex-wrap items-center gap-2">{meta}</div> : null}
        <h1 className="text-[32px] font-semibold leading-[1.1] tracking-[-0.025em] text-fg sm:text-[40px]">{title}</h1>
        {description ? <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-fg-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Panel({ title, aside, children, className, id }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cn("rounded-[var(--radius-lg)] border border-border bg-surface shadow-[var(--shadow-1)]", className)} aria-labelledby={id && title ? `${id}-title` : undefined}>
      {title ? (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3.5">
          <h2 id={id ? `${id}-title` : undefined} className="text-sm font-medium text-fg">
            {title}
          </h2>
          {aside ? <div className="flex items-center gap-2">{aside}</div> : null}
        </header>
      ) : null}
      <div className="p-5">{children}</div>
    </section>
  );
}
