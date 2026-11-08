"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { DOCS_NAV } from "./nav";

export function DocsSidebar() {
  const pathname = usePathname();
  return (
    <nav aria-label="Docs" className="lg:sticky lg:top-24">
      <ul className="flex gap-1 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:pb-0">
        {DOCS_NAV.map((n) => {
          const active = pathname === n.href;
          return (
            <li key={n.href} className="shrink-0">
              <Link
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "block rounded-md px-3 py-1.5 text-sm transition-colors",
                  active ? "bg-surface-hover text-fg" : "text-fg-muted hover:text-fg",
                )}
              >
                {n.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
