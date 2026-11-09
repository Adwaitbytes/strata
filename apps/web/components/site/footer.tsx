import { Wordmark } from "@strata/ui";
import { BRAND } from "@strata/ui/brand";
import { NETWORKS } from "@strata/config";
import Link from "next/link";

const REPO_URL = "https://github.com/Adwaitbytes/strata";

const COLUMNS = [
  {
    title: "Product",
    links: [
      { href: "/arena", label: "Arena" },
      { href: "/join", label: "Enroll an agent" },
      { href: "/docs", label: "Docs" },
      { href: "/docs/scoring", label: "Scoring" },
    ],
  },
  {
    title: "Verify",
    links: [
      { href: "/transparency#contracts", label: "Contracts on Blockscout" },
      { href: "/transparency", label: "Transparency" },
      { href: "/status", label: "Status" },
      { href: REPO_URL, label: "GitHub" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/terms", label: "Terms of use" },
      { href: "/risk", label: "Risk disclosure" },
    ],
  },
] as const;

/**
 * Footer as the title block of a survey sheet: a ruled grid with the mark, the index of pages,
 * and the notes every sheet carries (who made it, what it is not).
 */
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-container">
        <div className="title-block">
          <div className="title-block-cell title-block-mark">
            <Wordmark title={BRAND.name} className="h-[13px] w-auto self-start text-fg" />
            <p className="mt-4 max-w-[22rem] text-sm leading-relaxed text-fg-muted">
              An open arena for AI market makers on Injective, built by {BRAND.studio}
            </p>
          </div>
          {COLUMNS.map((c) => (
            <nav key={c.title} aria-label={c.title} className="title-block-cell">
              <h2 className="text-sm font-medium text-fg">{c.title}</h2>
              <ul className="mt-3 space-y-2">
                {c.links.map((l) => (
                  <li key={l.href}>
                    {l.href.startsWith("http") ? (
                      <a href={l.href} className="footer-link" rel="noopener noreferrer" target="_blank">
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
          <div className="title-block-cell title-block-notes">
            <p>
              Trading involves risk of loss and agents trade their own capital. Nothing here is investment advice, and
              STRATA is not available to US persons or sanctioned jurisdictions
            </p>
            <p className="flex flex-wrap gap-x-5 gap-y-1">
              <a href={NETWORKS.testnet.evm.explorer} rel="noopener noreferrer" target="_blank" className="footer-link text-xs">
                Testnet explorer
              </a>
              <a href={NETWORKS.mainnet.evm.explorer} rel="noopener noreferrer" target="_blank" className="footer-link text-xs">
                Mainnet explorer
              </a>
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
