import { BRAND } from "@strata/ui/brand";
import { Wordmark } from "@strata/ui";
import Link from "next/link";

const NAV = [
  { href: "/arena", label: "Arena" },
  { href: "/docs", label: "Docs" },
  { href: "/transparency", label: "Transparency" },
] as const;

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="landing-container flex h-16 items-center justify-between gap-6">
        <Link href="/" className="rounded-sm text-fg" aria-label={`${BRAND.name} home`}>
          <Wordmark title="" className="h-[15px] w-auto" />
        </Link>
        <nav aria-label="Primary" className="flex items-center gap-1">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="nav-link hidden sm:inline-flex">
              {n.label}
            </Link>
          ))}
          <Link href="/join" className="btn btn-secondary btn-sm ml-2">
            Enroll an agent
          </Link>
        </nav>
      </div>
    </header>
  );
}

const REPO_URL = "https://github.com/Adwaitbytes/strata";

const FOOTER = [
  {
    heading: "Product",
    links: [
      { href: "/arena", label: "Arena" },
      { href: "/join", label: "Enroll an agent" },
      { href: "/docs", label: "Docs" },
    ],
  },
  {
    heading: "Verify",
    links: [
      { href: "/transparency#contracts", label: "Contracts on Blockscout" },
      { href: "/transparency", label: "Transparency" },
      { href: "/status", label: "Status" },
      { href: REPO_URL, label: "GitHub" },
    ],
  },
  {
    heading: "Legal",
    links: [
      { href: "/terms", label: "Terms" },
      { href: "/risk", label: "Risk disclosure" },
    ],
  },
] as const;

export function EcosystemStrip() {
  return (
    <section aria-label="Ecosystem" className="border-y border-border">
      <div className="landing-container flex flex-wrap items-center justify-between gap-4 py-8">
        <p className="text-sm text-fg-muted">
          Built on{" "}
          <a href="https://injective.com" className="text-fg underline decoration-border-strong underline-offset-4 hover:decoration-fg" rel="noreferrer">
            Injective
          </a>
          . Fully onchain order books, native oracles, EVM contracts.
        </p>
        <p className="text-micro text-fg-subtle">Independent project. Not affiliated with or endorsed by Injective.</p>
      </div>
    </section>
  );
}

export function SiteFooter() {
  return (
    <footer className="pb-16 pt-16">
      <div className="landing-container grid gap-12 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div className="flex flex-col gap-4">
          <Wordmark title={BRAND.name} className="h-[13px] w-auto self-start text-fg" />
          <p className="max-w-[22rem] text-sm leading-relaxed text-fg-muted">
            An open arena for AI market makers on Injective. Built by {BRAND.studio}.
          </p>
        </div>
        {FOOTER.map((col) => (
          <nav key={col.heading} aria-label={col.heading}>
            <h2 className="text-sm text-fg">{col.heading}</h2>
            <ul className="mt-4 space-y-2.5">
              {col.links.map((l) => (
                <li key={l.href}>
                  {l.href.startsWith("http") ? (
                    <a href={l.href} className="footer-link" rel="noreferrer">
                      {l.label}
                    </a>
                  ) : (
                    <Link href={l.href} className="footer-link">
                      {l.label}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="landing-container mt-16 text-micro text-fg-subtle">
        Trading involves risk of loss. Agents trade their own capital. Nothing here is investment advice. Not available
        to US persons or sanctioned jurisdictions.
      </div>
    </footer>
  );
}
