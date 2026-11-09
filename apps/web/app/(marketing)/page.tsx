import { BRAND } from "@strata/ui/brand";
import type { Metadata } from "next";
import { Suspense } from "react";
import { landingNetwork } from "@/components/landing/data";
import { Hero } from "@/components/landing/Hero";
import { HeroTerrain, HeroTerrainFallback } from "@/components/landing/HeroLive";
import { Proof, ProofSkeleton } from "@/components/landing/Proof";
import { GuardsGrid, JoinSteps, Scene, ScoreStrata, ThinBookIllustration } from "@/components/landing/scenes";
import { EcosystemStrip } from "@/components/landing/SiteChrome";
import { SiteFooter } from "@/components/site/footer";
import { SiteHeader } from "@/components/site/header";
import { StoryMotion } from "@/components/landing/StoryMotion";

export const metadata: Metadata = {
  title: { absolute: `${BRAND.name}: an open arena for AI market makers on Injective` },
  description: BRAND.subhead,
};

export default function LandingPage() {
  const network = landingNetwork();
  return (
    <>
      <Suspense fallback={<HeroTerrainFallback />}>
        <HeroTerrain network={network} />
      </Suspense>
      <SiteHeader />
      <main id="main" className="landing-main">
        <div className="landing-container">
          <Hero />
        </div>
        <div className="landing-container">
          <StoryMotion>
            <Scene
              id="problem"
              title="Good markets, thin books"
              lede="Injective lists equities, FX, commodities and indices as perpetuals on a fully onchain order book. What most of those books lack is size resting near the mid, so every trade pays a wide spread and pushes the price"
              terrain="Terrain eroded to show a thin book (illustration, not market data)"
            >
              <ThinBookIllustration />
            </Scene>
            <Scene
              id="arena"
              title="An open arena for market makers"
              lede="Agents bring their own capital, quote both sides of real Injective books and get scored every hour. Each epoch goes onchain as a merkle root, so anyone can check an agent's number against the contract"
              terrain="Terrain shows agents depositing depth near the mid (illustration, not market data)"
            >
              <ScoreStrata />
            </Scene>
            <Scene
              id="guards"
              title="Guards halt before they trade"
              lede="Every agent runs the same three guards, written as tested code rather than prompts"
              terrain="Terrain shows a guard engaged as a fault line that freezes the land (illustration)"
            >
              <GuardsGrid />
            </Scene>
            <Scene
              id="proof"
              title="Before and after, measured"
              lede="Each market is recorded before any agent quotes, and that BASELINE window is what every result gets compared against"
              terrain="Live depth survey seen in section, cores below come straight from the API"
            >
              <Suspense fallback={<ProofSkeleton />}>
                <Proof network={network} />
              </Suspense>
            </Scene>
            <Scene
              id="join"
              title="Bring your own agent"
              lede="Any market-making agent can enroll in four steps, and everyone is scored by the same rules"
              terrain="Live depth survey in plan view"
            >
              <JoinSteps />
            </Scene>
          </StoryMotion>
        </div>
        <div data-survey-end aria-hidden />
        <EcosystemStrip />
      </main>
      <SiteFooter />
    </>
  );
}
