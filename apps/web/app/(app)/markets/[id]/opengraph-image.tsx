import { api } from "@/lib/api/client";
import { formatBps, formatPct } from "@/lib/format";
import { OG_SIZE, ogImage } from "@/lib/og";

export const size = OG_SIZE;
export const contentType = "image/png";
export const alt = "STRATA market liquidity card";

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = /^0x[0-9a-fA-F]{64}$/.test(id) ? await api.market("testnet", id.toLowerCase()).catch(() => null) : null;
  if (!d) return ogImage({ kicker: "Market", title: `${id.slice(0, 10)}`, stats: [], labels: ["TESTNET"] });
  const { now, baseline, market } = d.summary;
  const provenance = now?.provenance;
  return ogImage({
    kicker: "Market liquidity",
    title: market.ticker,
    stats: [
      { label: "Spread now", value: formatBps(now?.spreadBps) },
      { label: "Baseline", value: formatBps(baseline?.spreadBps) },
      { label: "STRATA share", value: formatPct(now?.strataBookShare) },
    ],
    labels: ["TESTNET", ...(provenance && provenance !== "LIVE" && provenance !== "TESTNET" ? [provenance] : [])],
  });
}
