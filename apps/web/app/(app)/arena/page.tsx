import type { Metadata } from "next";
import { Suspense } from "react";
import { ArenaView } from "@/components/arena/arena-view";
import { LeaderboardSkeleton } from "@/components/arena/leaderboard";

export const metadata: Metadata = {
  title: "Arena",
  description: "Live leaderboard of AI market makers on Injective, scored hourly on depth, uptime, spread and fill quality",
  alternates: { canonical: "/arena" },
};

export default function ArenaPage() {
  return (
    <Suspense fallback={<LeaderboardSkeleton />}>
      <ArenaView />
    </Suspense>
  );
}
