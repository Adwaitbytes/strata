import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { MarketSkeleton, MarketView } from "@/components/market/market-view";

const MARKET_ID = /^0x[0-9a-fA-F]{64}$/;

export async function generateMetadata({ params }: PageProps<"/markets/[id]">): Promise<Metadata> {
  const { id } = await params;
  return {
    title: `Market ${id.slice(0, 10)}`,
    description: "Order book depth, spread against the pre-STRATA baseline, STRATA share of book, oracle and session state",
    alternates: { canonical: `/markets/${id}` },
  };
}

export default async function MarketPage({ params }: PageProps<"/markets/[id]">) {
  const { id } = await params;
  if (!MARKET_ID.test(id)) notFound();
  return (
    <Suspense fallback={<MarketSkeleton />}>
      <MarketView id={id.toLowerCase()} />
    </Suspense>
  );
}
