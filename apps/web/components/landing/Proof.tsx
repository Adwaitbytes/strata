import type { NetworkName } from "@strata/sdk";
import { NetworkBadge, ProvenanceBadge } from "./Badges";
import { getMarkets } from "./data";
import { buildBaselineCores, buildProofRows, formatBps, formatUsdCompact } from "./model";
import { ProofChart } from "./ProofChart";

const dateFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const timeFmt = new Intl.DateTimeFormat("en-US", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" });

/**
 * Before vs after from the API, drawn as core samples. A before/after pair exists only for markets
 * with a closed BASELINE window and live STRATA depth. Until then the scene shows the BASELINE
 * cores that were actually recorded, with the "with STRATA" bed marked as not measured.
 */
export async function Proof({ network }: { network: NetworkName }) {
  const result = await getMarkets(network);
  const data = result.status === "ok" ? result.data : null;
  const rows = buildProofRows(data);
  const source = result.status === "ok" ? "Source: STRATA API /v1/markets" : `Source: STRATA API /v1/markets (${result.reason})`;

  if (rows.length > 0) {
    const first = rows[0];
    return (
      <div>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <NetworkBadge network={network} />
          <ProvenanceBadge provenance="BASELINE" />
          {first ? <ProvenanceBadge provenance={first.provenance} /> : null}
          {first ? (
            <span className="text-micro text-fg-subtle">
              Baseline window {dateFmt.format(first.baselineWindow.start)} to {dateFmt.format(first.baselineWindow.end)}
            </span>
          ) : null}
        </div>
        <ProofChart rows={rows} />
        <p className="mt-4 text-micro text-fg-subtle">{source}. Spread is the quoted spread in bps; depth is USD resting within 25 bps of mid.</p>
      </div>
    );
  }

  const cores = buildBaselineCores(data);
  if (cores.length === 0) {
    return (
      <div className="instrument p-6 sm:p-8">
        <div className="flex flex-wrap items-center gap-2">
          <NetworkBadge network={network} />
          <ProvenanceBadge provenance="BASELINE" />
        </div>
        <p className="mt-4 max-w-[34rem] text-fg">No comparison to show yet.</p>
        <p className="mt-2 max-w-[34rem] text-sm leading-relaxed text-fg-muted">
          Each market&apos;s spread and depth are recorded for at least 12 hours before agents quote. That window is the
          BASELINE. This section fills in once a market has both a closed baseline and live agent quotes.
        </p>
        <p className="mt-4 text-micro text-fg-subtle">{source}</p>
      </div>
    );
  }

  const max = Math.max(1, ...cores.map((c) => c.depthUsd));
  const first = cores[0];
  return (
    <figure className="m-0">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <NetworkBadge network={network} />
        <ProvenanceBadge provenance="BASELINE" />
        {first ? (
          <span className="text-micro text-fg-subtle">
            Window {dateFmt.format(first.windowStart)} {timeFmt.format(first.windowStart)} to {dateFmt.format(first.windowEnd)}{" "}
            {timeFmt.format(first.windowEnd)} UTC
          </span>
        ) : null}
      </div>
      <div className="instrument p-5 sm:p-6">
        <div className="cores" aria-hidden>
          {cores.map((c) => (
            <div key={c.marketId} className="core">
              <div className="core-tube">
                <span className="core-bed core-bed-baseline" style={{ height: `${Math.max(2, Math.sqrt(c.depthUsd / max) * 100)}%` }} />
              </div>
              <span className="core-label text-fg">{c.symbol}</span>
              <span className="core-value num">{c.depthUsd > 0 ? formatUsdCompact(c.depthUsd) : "No depth"}</span>
            </div>
          ))}
        </div>
        <table className="sr-only">
          <caption>Depth within 25 bps of mid during each market&apos;s BASELINE window, testnet</caption>
          <thead>
            <tr>
              <th scope="col">Market</th>
              <th scope="col">Baseline depth</th>
              <th scope="col">Baseline spread</th>
              <th scope="col">With STRATA</th>
            </tr>
          </thead>
          <tbody>
            {cores.map((c) => (
              <tr key={c.marketId}>
                <th scope="row">{c.symbol}</th>
                <td>{formatUsdCompact(c.depthUsd)}</td>
                <td>{c.spreadBps === null ? "No reading" : formatBps(c.spreadBps).replace("+", "")}</td>
                <td>Not measured yet</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-4 text-micro text-fg-muted">
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="core-key core-bed-baseline" /> Baseline depth, square-root scale
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="core-key border border-dashed border-accent" /> With STRATA: not measured yet
          </span>
        </div>
      </div>
      <figcaption className="mt-4 text-micro text-fg-subtle">
        Before cores only. The after bed is drawn once STRATA agents have depth on a market whose baseline window has closed. {source}.
      </figcaption>
    </figure>
  );
}

export function ProofSkeleton() {
  return <div role="status" aria-busy="true" aria-label="Loading comparison" className="h-64 animate-pulse rounded-md bg-surface" />;
}
