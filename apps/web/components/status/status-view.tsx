"use client";

import type { StatusResponse } from "@strata/sdk";
import { Skeleton } from "@strata/ui/data";
import { CheckCircle2, XCircle } from "lucide-react";
import { DataLabels } from "@/components/data/labels";
import { NetworkToggle } from "@/components/data/network-toggle";
import { PageHeader, Panel } from "@/components/data/page-header";
import { Stat } from "@/components/data/stat";
import { EmptyState, ErrorState } from "@/components/data/states";
import { useLiveQuery } from "@/hooks/use-live-query";
import { useNetwork } from "@/hooks/use-network";
import { api } from "@/lib/api/client";
import { explorerUrl } from "@/lib/chains";
import { formatUtc, shortHex } from "@/lib/format";

export function StatusView() {
  const [network] = useNetwork();
  const q = useLiveQuery<StatusResponse>({
    queryKey: ["status", network],
    network,
    fetcher: ({ signal }) => api.status(network, { signal }),
    pollMs: 10_000,
  });
  const d = q.data;
  const allOk = d ? d.services.length > 0 && d.services.every((s) => s.ok) : null;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader meta={<DataLabels network={network} />} title="Status" description="Health of every STRATA service, how far behind the chain the data is, and the last epoch posted onchain." actions={<NetworkToggle />} />

      {q.isPending ? (
        <div className="flex flex-col gap-6" aria-busy="true">
          <Skeleton style={{ height: 72, borderRadius: 14 }} />
          <Skeleton style={{ height: 120, borderRadius: 14 }} />
          <Skeleton style={{ height: 240, borderRadius: 14 }} />
        </div>
      ) : !d ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <>
          <div
            role="status"
            className={`flex items-center gap-3 rounded-[var(--radius-lg)] border px-5 py-4 ${allOk ? "border-bid/30 bg-bid-soft" : allOk === false ? "border-warn/40 bg-warn-soft" : "border-border bg-surface"}`}
          >
            {allOk ? <CheckCircle2 className="size-5 text-bid" aria-hidden /> : <XCircle className="size-5 text-warn" aria-hidden />}
            <p className="text-sm font-medium text-fg">
              {d.services.length === 0 ? `No services reporting on ${network}` : allOk ? "All services operational" : `${d.services.filter((s) => !s.ok).length} of ${d.services.length} services need attention`}
            </p>
            <span className="ml-auto text-xs text-fg-muted">Checked {formatUtc(d.at)}</span>
          </div>

          <section aria-label="Data freshness" className="grid grid-cols-1 gap-px overflow-hidden rounded-[var(--radius-lg)] border border-border bg-border sm:grid-cols-3">
            <div className="bg-surface p-5">
              <Stat metric="dataLag" value={d.dataLagSec == null ? "n/a" : `${d.dataLagSec.toFixed(1)}s`} />
            </div>
            <div className="bg-surface p-5">
              <div className="flex flex-col gap-2">
                <span className="text-[13px] text-fg-muted">Last block seen</span>
                <span className="num text-[26px] font-medium leading-none text-fg">{d.lastBlockHeight == null ? "n/a" : d.lastBlockHeight.toLocaleString("en-US")}</span>
              </div>
            </div>
            <div className="bg-surface p-5">
              <div className="flex flex-col gap-2">
                <span className="text-[13px] text-fg-muted">Last epoch posted</span>
                <span className="num text-[26px] font-medium leading-none text-fg">{d.lastEpochPosted ? `${d.lastEpochPosted.season}.${d.lastEpochPosted.epoch}` : "None yet"}</span>
                {d.lastEpochPosted ? (
                  <span className="text-xs text-fg-subtle">
                    {d.lastEpochPosted.txHash ? (
                      <a className="num text-accent hover:underline" href={explorerUrl(network, "tx", d.lastEpochPosted.txHash)} target="_blank" rel="noopener noreferrer">
                        {shortHex(d.lastEpochPosted.txHash)}
                      </a>
                    ) : (
                      "Root computed, not yet posted onchain"
                    )}
                  </span>
                ) : null}
              </div>
            </div>
          </section>

          <Panel title="Services" id="services">
            {d.services.length ? (
              <ul className="divide-y divide-border">
                {d.services.map((s) => (
                  <li
                    key={s.name}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[200px_110px_minmax(0,1fr)_auto]"
                    data-testid="service-row"
                  >
                    <span className="inline-flex min-w-0 items-center gap-2 text-sm text-fg">
                      <span aria-hidden className={`size-2 shrink-0 rounded-full ${s.ok ? "bg-bid" : "bg-warn"}`} />
                      <span className="num truncate">{s.name}</span>
                    </span>
                    <span className={`text-sm sm:order-none ${s.ok ? "text-fg-muted" : "text-warn"}`}>{s.ok ? "Operational" : "Degraded"}</span>
                    <span className="col-span-2 text-sm text-fg-muted sm:col-span-1">{s.detail}</span>
                    <span className="col-span-2 text-xs text-fg-subtle sm:col-span-1 sm:text-right">{s.lastSeenAt ? `Seen ${formatUtc(s.lastSeenAt)}` : "Never seen"}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="Nothing reporting" detail={network === "mainnet" ? "STRATA services run on testnet today." : "Services report here once they start."} className="border-0 p-0" />
            )}
          </Panel>
        </>
      )}
    </div>
  );
}
