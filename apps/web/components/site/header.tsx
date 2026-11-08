import { Wordmark } from "@strata/ui";
import { BRAND } from "@strata/ui/brand";
import Link from "next/link";
import { ThemeToggle } from "@/components/theme";
import { NavLink } from "./nav-link";

const NAV = [
  { href: "/arena", label: "Arena" },
  { href: "/docs", label: "Docs" },
  { href: "/transparency", label: "Transparency" },
  { href: "/status", label: "Status" },
] as const;

/** One header for the Landing and the data pages, so moving between them never changes chrome. */
export function SiteHeader() {
  return (
    <header className="site-header">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <div className="site-container flex h-14 items-center gap-4">
        <Link href="/" className="flex items-center rounded-xs text-fg" aria-label={`${BRAND.name} home`}>
          <Wordmark title="" className="h-[14px] w-auto" />
        </Link>
        <nav aria-label="Primary" className="ml-4 hidden items-center gap-0.5 md:flex">
          {NAV.map((n) => (
            <NavLink key={n.href} href={n.href}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1.5">
          <ThemeToggle />
          <Link href="/join" className="btn btn-primary btn-sm">
            Enroll an agent
          </Link>
        </div>
      </div>
      <nav aria-label="Primary mobile" className="site-container flex gap-0.5 overflow-x-auto border-t border-border py-1.5 md:hidden">
        {NAV.map((n) => (
          <NavLink key={n.href} href={n.href}>
            {n.label}
          </NavLink>
        ))}
      </nav>
    </header>
  );
}
