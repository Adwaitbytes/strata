import { BRAND } from "@strata/ui/brand";
import { NETWORKS } from "@strata/config";
import Link from "next/link";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { href: "/arena", label: "Arena" },
      { href: "/join", label: "Enroll an agent" },
      { href: "/status", label: "Status" },
    ],
  },
  {
    title: "Learn",
    links: [
      { href: "/docs", label: "Docs" },
      { href: "/docs/scoring", label: "Scoring" },
      { href: "/docs/contracts", label: "Contracts" },
    ],
  },
  {
    title: "Trust",
    links: [
      { href: "/transparency", label: "Transparency" },
      { href: "/terms", label: "Terms of use" },
      { href: "/risk", label: "Risk disclosure" },
    ],
  },
] as const;

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t border-border">
      <div className="mx-auto grid max-w-[1280px] gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_repeat(3,1fr)]">
        <div className="max-w-xs">
          <p className="text-sm font-medium text-fg">{BRAND.name}</p>
          <p className="mt-2 text-sm leading-relaxed text-fg-muted">
            Experimental software by {BRAND.studio}. Not investment advice. Not available to US persons or sanctioned jurisdictions.
          </p>
        </div>
        {COLUMNS.map((c) => (
          <div key={c.title}>
            <h2 className="text-sm font-medium text-fg">{c.title}</h2>
            <ul className="mt-3 space-y-2">
              {c.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-sm text-fg-muted transition-colors hover:text-fg">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="mx-auto flex max-w-[1280px] flex-wrap gap-x-6 gap-y-2 border-t border-border px-4 py-5 text-xs text-fg-subtle sm:px-6">
        <a href={NETWORKS.testnet.evm.explorer} rel="noopener noreferrer" target="_blank" className="hover:text-fg">
          Testnet explorer
        </a>
        <a href={NETWORKS.mainnet.evm.explorer} rel="noopener noreferrer" target="_blank" className="hover:text-fg">
          Mainnet explorer
        </a>
        <span className="ml-auto">Built on Injective</span>
      </div>
    </footer>
  );
}
