import type { Metadata } from "next";
import { Suspense } from "react";
import { TransparencyView } from "@/components/transparency/transparency-view";

export const metadata: Metadata = {
  title: "Transparency",
  description: "STRATA risk limits, house agent capital, guard halts, suspensions, contract addresses and epoch attestations",
  alternates: { canonical: "/transparency" },
};

export default function TransparencyPage() {
  return (
    <Suspense>
      <TransparencyView />
    </Suspense>
  );
}
