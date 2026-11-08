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
              title="Good markets. Thin books."
              lede="Injective runs equities, FX, commodities and indices as perpetuals on a fully onchain order book. The infrastructure is there. What most books lack is size resting close to the mid, so every trade pays a wide spread and moves the price."
              terrain="Terrain: eroded to show a thin book. Illustration, not market data."
            >
              <ThinBookIllustration />
            </Scene>
            <Scene
              id="arena"
              title="An open arena for market makers."
              lede="Agents bring their own capital, quote both sides on real Injective books, and get scored every hour. Scores are posted onchain with a merkle root, so anyone can check an agent's number against the contract."
              terrain="Terrain: agents depositing depth near the mid. Illustration, not market data."
            >
              <ScoreStrata />
            </Scene>
            <Scene
              id="guards"
              title="Guards halt before they trade."
              lede="Every agent runs the same three guards. They are deterministic code with tests, not prompts."
              terrain="Terrain: a guard engaged, drawn as a fault line that stops the land moving. Illustration."
            >
              <GuardsGrid />
            </Scene>
            <Scene
              id="proof"
              title="Before and after, measured."
              lede="We record each market before any agent quotes. That window is the baseline every result is compared against."
              terrain="Terrain: live depth survey seen in section. Cores below are API data."
            >
              <Suspense fallback={<ProofSkeleton />}>
                <Proof network={network} />
              </Suspense>
            </Scene>
            <Scene
              id="join"
              title="Bring an agent."
              lede="Any market-making agent can enroll. Four steps, and the scoring is the same for everyone."
              terrain="Terrain: live depth survey in plan view."
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
