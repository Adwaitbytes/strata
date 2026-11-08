import { NETWORKS } from "@strata/config";
import { NetworkBadge } from "@strata/ui/data";
import { explorerUrl } from "@/lib/chains";

const ROWS = [
  { key: "arena", label: "StrataArena" },
  { key: "attestor", label: "ScoreAttestor" },
  { key: "rewards", label: "RewardsDistributor" },
  { key: "identityRegistry", label: "ERC-8004 identity registry" },
] as const;

export function ContractsTable() {
  return (
    <div className="my-6 flex flex-col gap-6">
      {(["testnet", "mainnet"] as const).map((n) => {
        const net = NETWORKS[n];
        return (
          <section key={n} className="overflow-hidden rounded-xl border border-border">
            <header className="flex flex-wrap items-center gap-3 border-b border-border bg-surface px-4 py-3">
              <NetworkBadge network={n} />
              <span className="text-sm text-fg">Chain {net.evm.chainId}</span>
              <span className="num text-xs text-fg-subtle">{net.evm.cosmosChainId}</span>
            </header>
            <dl className="divide-y divide-border text-sm">
              {ROWS.map((r) => {
                const addr = net.contracts[r.key];
                return (
                  <div key={r.key} className="grid gap-1 px-4 py-2.5 sm:grid-cols-[220px_1fr]">
                    <dt className="text-fg-muted">{r.label}</dt>
                    <dd className="num break-all text-fg">
                      {addr ? (
                        <a href={explorerUrl(n, "address", addr)} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                          {addr}
                        </a>
                      ) : (
                        <span className="text-fg-subtle">Not deployed</span>
                      )}
                    </dd>
                  </div>
                );
              })}
              <div className="grid gap-1 px-4 py-2.5 sm:grid-cols-[220px_1fr]">
                <dt className="text-fg-muted">RPC</dt>
                <dd className="num break-all text-fg">{net.evm.rpcUrls[0]}</dd>
              </div>
              <div className="grid gap-1 px-4 py-2.5 sm:grid-cols-[220px_1fr]">
                <dt className="text-fg-muted">Explorer</dt>
                <dd>
                  <a href={net.evm.explorer} target="_blank" rel="noopener noreferrer" className="num text-accent hover:underline">
                    {net.evm.explorer}
                  </a>
                </dd>
              </div>
              {net.evm.faucets.length ? (
                <div className="grid gap-1 px-4 py-2.5 sm:grid-cols-[220px_1fr]">
                  <dt className="text-fg-muted">Faucets</dt>
                  <dd className="flex flex-col gap-1">
                    {net.evm.faucets.map((f) => (
                      <a key={f} href={f} target="_blank" rel="noopener noreferrer" className="num break-all text-accent hover:underline">
                        {f}
                      </a>
                    ))}
                  </dd>
                </div>
              ) : null}
            </dl>
          </section>
        );
      })}
    </div>
  );
}
