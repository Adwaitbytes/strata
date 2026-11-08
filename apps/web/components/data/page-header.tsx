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
    <div className={className}>
      <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          {meta ? <div className="mb-4 flex flex-wrap items-center gap-2">{meta}</div> : null}
          <h1 className="font-display text-h1 text-fg">{title}</h1>
          {description ? <div className="mt-4 max-w-[60ch] text-[15px] leading-relaxed text-fg-muted">{description}</div> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      <div aria-hidden className="measure-rule mt-8" />
    </div>
  );
}

/** Section heading outside a panel. */
export function SectionTitle({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2 id={id} className="text-h3 font-medium text-fg">
      {children}
    </h2>
  );
}

export function Panel({ title, aside, children, className, id }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={cn("instrument shadow-[var(--shadow-1)]", className)} aria-labelledby={id && title ? `${id}-title` : undefined}>
      {title ? (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3.5">
          <h2 id={id ? `${id}-title` : undefined} className="text-[15px] font-medium tracking-[-0.005em] text-fg">
            {title}
          </h2>
          {aside ? <div className="flex items-center gap-2">{aside}</div> : null}
        </header>
      ) : null}
      <div className="p-5">{children}</div>
    </section>
  );
}
