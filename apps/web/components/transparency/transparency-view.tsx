"use client";

import { MAINNET_CAPITAL_CAP_USD, NETWORKS } from "@strata/config";
import type { TransparencyResponse } from "@strata/sdk";
import { Skeleton } from "@strata/ui/data";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { GuardTimeline } from "@/components/agent/guard-timeline";
import { InfoTip } from "@/components/data/info-tip";
import { DataLabels } from "@/components/data/labels";
import { NetworkToggle } from "@/components/data/network-toggle";
import { PageHeader, Panel } from "@/components/data/page-header";
import { EmptyState, ErrorState } from "@/components/data/states";
import { useNetwork } from "@/hooks/use-network";
import { api } from "@/lib/api/client";
import { dominantProvenance } from "@/lib/api/provenance";
import { explorerUrl } from "@/lib/chains";
import { formatUsd, formatUtc, shortHex } from "@/lib/format";

const LIMIT_LABEL: Record<string, string> = {
  maxGrossNotionalUsd: "Max gross notional",
  maxNetNotionalUsd: "Max net notional per market",
  maxDailyLossUsd: "Max daily loss",
  maxDrawdownUsd: "Max season drawdown",
  maxOrdersPerMin: "Max orders per minute",
};

function limitValue(k: string, v: number | string | boolean): string {
  if (typeof v === "number" && /Usd$/.test(k)) return formatUsd(v);
  return String(v);
}

function Address({ network, value }: { network: "mainnet" | "testnet"; value: string | null }) {
  if (!value) return <span className="text-fg-subtle">Not deployed</span>;
  return (
    <a href={explorerUrl(network, "address", value)} target="_blank" rel="noopener noreferrer" className="num inline-flex items-center gap-1 break-all text-accent hover:underline">
      {value} <ExternalLink className="size-3 shrink-0" aria-hidden />
    </a>
  );
}

export function TransparencyView() {
  const [network] = useNetwork();
  const q = useQuery<TransparencyResponse>({ queryKey: ["transparency", network], queryFn: ({ signal }) => api.transparency(network, { signal }) });
  const d = q.data;
  const provenance = d ? dominantProvenance(d.guardEvents.map((e) => e.provenance)) : null;
  // Prefer the API's view of deployed contracts; fall back to the committed config.
  const contracts = {
    arena: d?.contracts.arena ?? NETWORKS[network].contracts.arena,
    attestor: d?.contracts.attestor ?? NETWORKS[network].contracts.attestor,
    rewards: d?.contracts.rewards ?? NETWORKS[network].contracts.rewards,
  };

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        meta={<DataLabels network={network} provenance={d && d.guardEvents.length ? provenance : null} />}
        title="Transparency"
        description="Every limit, every halt and every attestation, in one place. If an agent was stopped or suspended, it shows up here with the reason."
        actions={<NetworkToggle />}
      />

      <Panel title="Contracts" id="contracts">
        <dl className="divide-y divide-border text-sm">
          {(
            [
              ["StrataArena", contracts.arena],
              ["ScoreAttestor", contracts.attestor],
              ["RewardsDistributor", contracts.rewards],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="grid gap-1 py-2.5 first:pt-0 last:pb-0 sm:grid-cols-[200px_1fr]">
              <dt className="text-fg-muted">{label}</dt>
              <dd className="min-w-0">
                <Address network={network} value={value} />
              </dd>
            </div>
          ))}
        </dl>
      </Panel>

      {q.isPending ? (
        <div className="grid gap-6 lg:grid-cols-2" aria-busy="true">
          <Skeleton style={{ height: 240, borderRadius: 14 }} />
          <Skeleton style={{ height: 240, borderRadius: 14 }} />
        </div>
      ) : q.isError || !d ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <>
          <Panel title={<InfoTip metric="capital">House agents and risk limits</InfoTip>} id="limits" aside={network === "mainnet" ? <span className="text-xs text-fg-subtle">Hard cap {formatUsd(MAINNET_CAPITAL_CAP_USD)} total, set in code</span> : null}>
            {d.houseAgents.length ? (
              <div className="grid gap-4 md:grid-cols-2">
                {d.houseAgents.map((h) => (
                  <div key={h.agentId} className="rounded-lg border border-border bg-bg-raised p-4">
                    <div className="flex items-baseline justify-between gap-2">
                      <Link href={`/agents/${h.agentId}${network === "mainnet" ? "?network=mainnet" : ""}`} className="font-medium text-fg hover:underline">
                        {h.name}
                      </Link>
                      <span className="num text-sm text-fg">{formatUsd(h.capitalUsd)}</span>
                    </div>
                    <p className="num mt-1 truncate text-xs text-fg-subtle" title={h.injAddress}>
                      {shortHex(h.injAddress, 10, 6)}
                    </p>
                    <dl className="mt-3 flex flex-col gap-1 text-[13px]">
                      {Object.entries(h.limits).map(([k, v]) => (
                        <div key={k} className="flex justify-between gap-3">
                          <dt className="text-fg-muted">{LIMIT_LABEL[k] ?? k}</dt>
                          <dd className="num text-fg">{limitValue(k, v)}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title={`No house agents on ${network}`} detail={network === "mainnet" ? "Mainnet house agents start once the owner funds them. Capital is capped in code." : "House agents appear once they are enrolled."} className="border-0 p-0" />
            )}
          </Panel>

          <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
            <Panel title="Guard halts log" id="halts">
              {d.guardEvents.length ? (
                <GuardTimeline events={d.guardEvents} showAgent />
              ) : (
                <EmptyState title="No guard events" detail="No agent has been halted or throttled by a guard on this network." className="border-0 p-0" />
              )}
            </Panel>
            <Panel title="Suspensions" id="suspensions">
              {d.suspensions.length ? (
                <ul className="flex flex-col gap-3">
                  {d.suspensions.map((s) => (
                    <li key={`${s.agentId}-${s.at}`} className="rounded-lg border border-halt/30 bg-halt-soft px-4 py-3">
                      <div className="flex items-baseline justify-between gap-2 text-sm">
                        <Link href={`/agents/${s.agentId}${network === "mainnet" ? "?network=mainnet" : ""}`} className="font-medium text-fg hover:underline">
                          Agent #{s.agentId}
                        </Link>
                        <time className="text-xs text-fg-subtle">{formatUtc(s.at)}</time>
                      </div>
                      <p className="mt-1 text-sm text-fg-muted">{s.reason}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title="No suspensions" detail="No agent has been suspended on this network." className="border-0 p-0" />
              )}
            </Panel>
          </div>

          <Panel title="Epoch attestations" id="epochs">
            {d.epochs.length ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <caption className="sr-only">Merkle roots posted to ScoreAttestor, newest first</caption>
                  <thead>
                    <tr className="text-xs text-fg-subtle">
                      <th scope="col" className="pb-2 pr-4 font-normal">Epoch</th>
                      <th scope="col" className="pb-2 pr-4 font-normal">Window</th>
                      <th scope="col" className="pb-2 pr-4 font-normal">Merkle root</th>
                      <th scope="col" className="pb-2 font-normal">Transaction</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...d.epochs]
                      .sort((a, b) => b.epoch - a.epoch)
                      .map((e) => (
                        <tr key={`${e.season}-${e.epoch}`} className="border-t border-border">
                          <td className="num py-2.5 pr-4 text-fg">
                            {e.season}.{e.epoch}
                          </td>
                          <td className="py-2.5 pr-4 text-fg-muted">{formatUtc(e.endTime)}</td>
                          <td className="num py-2.5 pr-4 text-fg-muted" title={e.merkleRoot}>
                            {shortHex(e.merkleRoot, 10, 8)}
                          </td>
                          <td className="py-2.5">
                            {e.txHash ? (
                              <a href={explorerUrl(network, "tx", e.txHash)} target="_blank" rel="noopener noreferrer" className="num text-accent hover:underline">
                                {shortHex(e.txHash, 10, 6)}
                              </a>
                            ) : (
                              <span className="text-fg-subtle">Not posted</span>
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState title="No epochs attested yet" detail="Roots appear here once the scorer posts the first epoch to ScoreAttestor." className="border-0 p-0" />
            )}
          </Panel>
        </>
      )}

      <Panel title="Security" id="security">
        <p className="text-sm leading-relaxed text-fg-muted">
          The security review covers the threat model, static analysis of the contracts, key management and known limitations. Read{" "}
          <a href="https://github.com/Adwaitbytes/strata/blob/main/docs/SECURITY.md" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
            docs/SECURITY.md
          </a>{" "}
          in the repository.
        </p>
      </Panel>
    </div>
  );
}
