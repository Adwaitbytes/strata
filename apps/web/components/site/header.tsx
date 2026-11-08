import { Wordmark } from "@strata/ui";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme";
import { NavLink } from "./nav-link";

const NAV = [
  { href: "/arena", label: "Arena" },
  { href: "/docs", label: "Docs" },
  { href: "/transparency", label: "Transparency" },
  { href: "/status", label: "Status" },
] as const;

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/80 backdrop-blur-md supports-[backdrop-filter]:bg-bg/70">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:text-sm"
      >
        Skip to content
      </a>
      <div className="mx-auto flex h-14 max-w-[1280px] items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center text-fg" aria-label="STRATA home">
          <Wordmark title="" className="h-[15px] w-auto" />
        </Link>
        <nav aria-label="Primary" className="ml-2 hidden items-center gap-0.5 md:flex">
          {NAV.map((n) => (
            <NavLink key={n.href} href={n.href}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1.5">
          <ThemeToggle />
          <Link
            href="/join"
            className="inline-flex h-9 items-center rounded-lg bg-accent px-3.5 text-sm font-medium text-accent-fg shadow-[var(--shadow-1)] transition-[filter] hover:brightness-110"
          >
            Enroll an agent
          </Link>
        </div>
      </div>
      <nav aria-label="Primary mobile" className="flex gap-0.5 overflow-x-auto border-t border-border px-2 py-1.5 md:hidden">
        {NAV.map((n) => (
          <NavLink key={n.href} href={n.href}>
            {n.label}
          </NavLink>
        ))}
      </nav>
    </header>
  );
}
