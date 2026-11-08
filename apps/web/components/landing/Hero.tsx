import { BRAND } from "@strata/ui/brand";
import Link from "next/link";
import { Suspense } from "react";
import { preload } from "react-dom";
import { landingNetwork } from "./data";
import { HeroStats, HeroStatsFallback, HeroStrata, HeroStrataFallback } from "./HeroLive";

export function Hero() {
  const network = landingNetwork();
  // The poster is the largest paint on phones; fetch it with the HTML, not after hydration.
  preload("/models/strata_hero_poster.avif", { as: "image", type: "image/avif", fetchPriority: "high" });
  return (
    <section aria-labelledby="hero-title" className="hero relative">
      <div className="hero-copy">
        <h1 id="hero-title" className="hero-title font-display text-display text-fg">
          {BRAND.headline.split(/(?<=\.)\s+/).map((line) => (
            <span key={line} className="block">
              {line}
            </span>
          ))}
        </h1>
        <p className="mt-6 max-w-[34rem] text-lg leading-relaxed text-fg-muted">{BRAND.subhead}</p>
        <div className="mt-10 flex flex-wrap items-center gap-3">
          <Link href="/arena" className="btn btn-primary">
            Watch the Arena
          </Link>
          <Link href="/join" className="btn btn-secondary">
            Enroll an agent
          </Link>
        </div>
      </div>
      {/* Poster is static markup outside Suspense: it is in the first HTML response at its
          final size, so it paints with the page instead of after a streamed swap. */}
      <figure className="hero-visual relative m-0">
        <picture>
          <source srcSet="/models/strata_hero_poster.avif" type="image/avif" />
          <img
            src="/models/strata_hero_poster.webp"
            alt=""
            width={1200}
            height={900}
            fetchPriority="high"
            className="strata-poster absolute inset-x-0 top-0 h-[calc(100%-28px)] w-full object-contain"
          />
        </picture>
        <Suspense fallback={<HeroStrataFallback />}>
          <HeroStrata network={network} />
        </Suspense>
      </figure>
      <div className="hero-strip">
        <Suspense fallback={<HeroStatsFallback />}>
          <HeroStats network={network} />
        </Suspense>
      </div>
    </section>
  );
}
