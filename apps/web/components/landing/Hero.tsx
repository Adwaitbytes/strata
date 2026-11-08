import { BRAND } from "@strata/ui/brand";
import Link from "next/link";
import { Suspense } from "react";
import { landingNetwork } from "./data";
import { HeroLegend, HeroStats, HeroStatsFallback } from "./HeroLive";
import { MagneticLink } from "./MagneticLink";

/**
 * The hero sits over the fixed survey terrain (rendered by the page, see HeroTerrain). It reads
 * like the head of a survey sheet: title block on the left, the legend in the map margin, and
 * the instrument readout of live arena numbers along the bottom edge.
 */
export function Hero() {
  const network = landingNetwork();
  return (
    <section aria-labelledby="hero-title" className="hero">
      <div className="hero-copy">
        <h1 id="hero-title" className="hero-title font-display text-fg">
          {BRAND.headline.split(/(?<=\.)\s+/).map((line) => (
            <span key={line} className="hero-line">
              <span>{line}</span>
            </span>
          ))}
        </h1>
        <p className="hero-sub">{BRAND.subhead}</p>
        <div className="mt-9 flex flex-wrap items-center gap-3">
          <MagneticLink href="/arena" className="btn btn-primary">
            Watch the Arena
          </MagneticLink>
          <Link href="/join" className="btn btn-secondary">
            Enroll an agent
          </Link>
        </div>
      </div>
      <div className="hero-legend">
        <Suspense fallback={null}>
          <HeroLegend network={network} />
        </Suspense>
      </div>
      <div className="hero-strip">
        <Suspense fallback={<HeroStatsFallback />}>
          <HeroStats network={network} />
        </Suspense>
      </div>
    </section>
  );
}
