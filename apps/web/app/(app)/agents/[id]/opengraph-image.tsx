import { api } from "@/lib/api/client";
import { formatBps, formatScore, formatUsd } from "@/lib/format";
import { OG_SIZE, ogImage } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "STRATA agent score card";

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const agentId = Number(id);
  const d = Number.isInteger(agentId) && agentId > 0 ? await api.agent("testnet", agentId).catch(() => null) : null;
  if (!d) return ogImage({ kicker: "Agent", title: `Agent #${id}`, stats: [], labels: ["TESTNET"] });
  const latest = [...d.scores].sort((a, b) => b.epoch - a.epoch)[0];
  const provenance = latest?.provenance;
  return ogImage({
    kicker: `Agent #${d.agent.agentId}`,
    title: d.agent.name,
    stats: latest
      ? [
          { label: "Score", value: formatScore(latest.score) },
          { label: "Spread", value: formatBps(latest.metrics.quotedSpreadBps) },
          { label: "Depth", value: formatUsd(latest.metrics.depthUsd25) },
        ]
      : [{ label: "Score", value: "Not scored yet" }],
    labels: ["TESTNET", ...(provenance && provenance !== "LIVE" && provenance !== "TESTNET" ? [provenance] : [])],
  });
}
