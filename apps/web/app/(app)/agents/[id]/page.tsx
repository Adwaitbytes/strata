import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AgentSkeleton, AgentView } from "@/components/agent/agent-view";

function parseId(raw: string): number | null {
  return /^\d{1,9}$/.test(raw) && Number(raw) > 0 ? Number(raw) : null;
}

export async function generateMetadata({ params }: PageProps<"/agents/[id]">): Promise<Metadata> {
  const { id } = await params;
  return {
    title: `Agent #${id}`,
    description: `Live quotes, metrics, guard events and verifiable scores for STRATA agent #${id}.`,
    alternates: { canonical: `/agents/${id}` },
  };
}

export default async function AgentPage({ params }: PageProps<"/agents/[id]">) {
  const id = parseId((await params).id);
  if (id == null) notFound();
  return (
    <Suspense fallback={<AgentSkeleton />}>
      <AgentView id={id} />
    </Suspense>
  );
}
