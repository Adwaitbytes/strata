import Link from "next/link";
import type { ComponentPropsWithoutRef } from "react";

/** Shared element styling for MDX pages and markdown pulled from docs/*.md. */
export const docsComponents = {
  h1: (p: ComponentPropsWithoutRef<"h1">) => <h1 className="font-display mb-6 text-h1 text-fg" {...p} />,
  h2: (p: ComponentPropsWithoutRef<"h2">) => <h2 className="mb-3 mt-12 scroll-mt-24 text-[22px] font-semibold tracking-[-0.015em] text-fg" {...p} />,
  h3: (p: ComponentPropsWithoutRef<"h3">) => <h3 className="mb-2 mt-8 text-[17px] font-semibold text-fg" {...p} />,
  p: (p: ComponentPropsWithoutRef<"p">) => <p className="my-4 text-[15px] leading-[1.75] text-fg-muted" {...p} />,
  ul: (p: ComponentPropsWithoutRef<"ul">) => <ul className="my-4 list-disc space-y-1.5 pl-6 text-[15px] leading-[1.7] text-fg-muted marker:text-fg-subtle" {...p} />,
  ol: (p: ComponentPropsWithoutRef<"ol">) => <ol className="my-4 list-decimal space-y-1.5 pl-6 text-[15px] leading-[1.7] text-fg-muted marker:text-fg-subtle" {...p} />,
  li: (p: ComponentPropsWithoutRef<"li">) => <li className="pl-1" {...p} />,
  strong: (p: ComponentPropsWithoutRef<"strong">) => <strong className="font-semibold text-fg" {...p} />,
  a: ({ href = "", ...p }: ComponentPropsWithoutRef<"a">) =>
    href.startsWith("/") || href.startsWith("#") ? (
      <Link href={href} className="text-accent underline decoration-accent/40 underline-offset-4 hover:decoration-accent" {...p} />
    ) : (
      <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent underline decoration-accent/40 underline-offset-4 hover:decoration-accent" {...p} />
    ),
  code: (p: ComponentPropsWithoutRef<"code">) => <code className="num rounded bg-surface-hover px-1.5 py-0.5 text-[0.86em] text-fg [pre_&]:bg-transparent [pre_&]:p-0" {...p} />,
  pre: (p: ComponentPropsWithoutRef<"pre">) => <pre tabIndex={0} className="my-5 overflow-x-auto rounded-xl border border-border bg-bg-sunken p-4 text-[13px] leading-relaxed" {...p} />,
  blockquote: (p: ComponentPropsWithoutRef<"blockquote">) => <blockquote className="my-5 border-l-2 border-accent pl-4 text-fg-muted" {...p} />,
  hr: () => <hr className="my-10 border-border" />,
  table: (p: ComponentPropsWithoutRef<"table">) => (
    <div className="my-6 overflow-x-auto rounded-xl border border-border">
      <table className="w-full border-collapse text-left text-sm" {...p} />
    </div>
  ),
  th: (p: ComponentPropsWithoutRef<"th">) => <th className="border-b border-border bg-surface px-4 py-2.5 font-medium text-fg" {...p} />,
  td: (p: ComponentPropsWithoutRef<"td">) => <td className="border-b border-border px-4 py-2.5 align-top text-fg-muted" {...p} />,
};
