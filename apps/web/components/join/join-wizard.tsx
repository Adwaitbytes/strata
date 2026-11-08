"use client";

import { NETWORKS } from "@strata/config";
import { strataArenaAbi, type NetworkName } from "@strata/sdk";
import { NetworkBadge } from "@strata/ui/data";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, Copy, Download, Loader2, Wallet } from "lucide-react";
import Link from "next/link";
import { useId, useMemo, useReducer, useState, useSyncExternalStore, type ReactNode } from "react";
import { parseEventLogs } from "viem";
import { type Connector, useConnection, useConnect, useConnectors, useDisconnect, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { EmptyState, ErrorState } from "@/components/data/states";
import { api } from "@/lib/api/client";
import { CHAINS, explorerUrl } from "@/lib/chains";
import { buildEnrollPreview, metadataJson, starterKit, validateAgentName, validateErc8004Id, validateMetadataUri } from "@/lib/enroll";
import { shortHex } from "@/lib/format";
import { cn } from "@/lib/utils";

const STEPS = ["Connect wallet", "Identity", "Markets and rules", "Enroll"] as const;

interface State {
  step: number;
  network: NetworkName;
  mainnetAck: boolean;
  erc8004Id: string;
  name: string;
  metadataURI: string;
  markets: string[];
  riskAck: boolean;
  geoAck: boolean;
}

type Action =
  | { type: "go"; step: number }
  | { type: "network"; network: NetworkName }
  | { type: "set"; patch: Partial<State> }
  | { type: "toggleMarket"; id: string };

const initial: State = { step: 0, network: "testnet", mainnetAck: false, erc8004Id: "", name: "", metadataURI: "", markets: [], riskAck: false, geoAck: false };

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "go":
      return { ...s, step: Math.max(0, Math.min(STEPS.length - 1, a.step)) };
    case "network":
      return { ...s, network: a.network, mainnetAck: false, markets: [] };
    case "set":
      return { ...s, ...a.patch };
    case "toggleMarket":
      return { ...s, markets: s.markets.includes(a.id) ? s.markets.filter((m) => m !== a.id) : [...s.markets, a.id] };
  }
}

function Button({ children, variant = "primary", className, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" }) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        "inline-flex h-10 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium transition-[filter,background-color,opacity] disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" ? "bg-accent text-accent-fg hover:brightness-110" : "border border-border-strong text-fg hover:bg-surface-hover",
        className,
      )}
    >
      {children}
    </button>
  );
}

function Check2({ checked, onChange, children, testId }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; testId?: string }) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        data-testid={testId}
        className="mt-0.5 size-4 shrink-0 cursor-pointer accent-[var(--accent)]"
      />
      <label htmlFor={id} className="cursor-pointer text-sm leading-relaxed text-fg-muted">
        {children}
      </label>
    </div>
  );
}

function Stepper({ step }: { step: number }) {
  return (
    <ol className="grid grid-cols-4 gap-2" aria-label="Enrollment steps">
      {STEPS.map((label, i) => (
        <li key={label} aria-current={i === step ? "step" : undefined} className="flex flex-col gap-2">
          <span className={cn("h-[3px] rounded-full transition-colors duration-300", i <= step ? "bg-accent" : "bg-border")} />
          <span className={cn("hidden text-xs sm:block", i === step ? "text-fg" : i < step ? "text-fg-muted" : "text-fg-subtle")}>
            <span className="num mr-1.5">{i + 1}</span>
            {label}
          </span>
        </li>
      ))}
    </ol>
  );
}

const noopSubscribe = () => () => undefined;

/** True when the browser exposes an EIP-1193 provider. Assumed true on the server to avoid a flash. */
function useHasInjectedProvider(): boolean {
  return useSyncExternalStore(noopSubscribe, () => "ethereum" in window && window.ethereum != null, () => true);
}

function StepConnect({ s, dispatch }: { s: State; dispatch: (a: Action) => void }) {
  const conn = useConnection();
  // EIP-6963 discovery adds wallets at runtime, so treat the list as open-ended.
  const allConnectors: readonly Connector[] = useConnectors();
  const hasProvider = useHasInjectedProvider();
  // The generic injected connector is always registered; it only works when a provider exists.
  const connectors = allConnectors.filter((c) => c.type !== "injected" || c.id !== "injected" || hasProvider);
  const connect = useConnect();
  const disconnect = useDisconnect();
  const switchChain = useSwitchChain();
  const target = CHAINS[s.network];
  const onTarget = conn.isConnected && conn.chainId === target.id;
  const mainnetBlocked = s.network === "mainnet" && !s.mainnetAck;

  return (
    <div className="flex flex-col gap-6">
      <fieldset className="flex flex-col gap-3">
        <legend className="mb-2 text-sm font-medium text-fg">Network</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {(["testnet", "mainnet"] as const).map((n) => (
            <label
              key={n}
              className={cn(
                "flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors",
                s.network === n ? "border-accent bg-accent-soft" : "border-border hover:border-border-strong",
              )}
            >
              <input type="radio" name="network" value={n} checked={s.network === n} onChange={() => dispatch({ type: "network", network: n })} className="mt-1 accent-[var(--accent)]" />
              <span className="flex flex-col gap-1">
                <span className="flex items-center gap-2 text-sm font-medium text-fg">
                  {n === "testnet" ? "Testnet" : "Mainnet"} <NetworkBadge network={n} />
                </span>
                <span className="text-xs text-fg-muted">
                  {n === "testnet" ? "Chain 1439. Free test funds from the faucet. Recommended." : "Chain 1776. Real funds and real risk."}
                </span>
              </span>
            </label>
          ))}
        </div>
        {s.network === "mainnet" ? (
          <div className="rounded-lg border border-warn/40 bg-warn-soft p-4">
            <Check2 checked={s.mainnetAck} onChange={(v) => dispatch({ type: "set", patch: { mainnetAck: v } })} testId="mainnet-ack">
              I understand mainnet uses real funds. My agent can lose money, and STRATA does not cover losses.
            </Check2>
          </div>
        ) : null}
      </fieldset>

      <div className="flex flex-col gap-3">
        <h3 className="text-sm font-medium text-fg">Wallet</h3>
        {conn.isConnected && conn.address ? (
          <div className="flex flex-col gap-3 rounded-xl border border-border bg-bg-raised p-4">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <Wallet className="size-4 text-fg-muted" aria-hidden />
              <span className="num text-fg" data-testid="connected-address">
                {shortHex(conn.address)}
              </span>
              <span className="text-fg-subtle">via {conn.connector?.name ?? "browser wallet"}</span>
              <button type="button" onClick={() => disconnect.mutate()} className="ml-auto text-xs text-fg-muted underline-offset-4 hover:text-fg hover:underline">
                Disconnect
              </button>
            </div>
            {onTarget ? (
              <p className="flex items-center gap-2 text-sm text-bid">
                <Check className="size-4" aria-hidden /> On {target.name} (chain {target.id})
              </p>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-sm text-warn">Your wallet is on chain {conn.chainId ?? "unknown"}. Switch to {target.name} (chain {target.id}) to continue.</p>
                <Button variant="secondary" disabled={mainnetBlocked || switchChain.isPending} onClick={() => switchChain.mutate({ chainId: target.id })}>
                  {switchChain.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
                  Switch to chain {target.id}
                </Button>
              </div>
            )}
            {switchChain.error ? <p className="text-xs text-halt">{switchChain.error.message.split("\n")[0]}</p> : null}
          </div>
        ) : connectors.length === 0 ? (
          <EmptyState
            title="No browser wallet found"
            detail="Install a wallet that supports Injective EVM, such as MetaMask or Rabby, then reload this page. Nothing is requested from your wallet until you click connect."
          />
        ) : (
          <div className="flex flex-wrap gap-2">
            {connectors.map((c) => (
              <Button key={c.uid} disabled={mainnetBlocked || connect.isPending} onClick={() => connect.mutate({ connector: c, chainId: target.id })}>
                {connect.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Wallet className="size-4" aria-hidden />}
                Connect {c.name === "Injected" ? "browser wallet" : c.name}
              </Button>
            ))}
          </div>
        )}
        {connect.error ? <p className="text-xs text-halt">{connect.error.message.split("\n")[0]}</p> : null}
        <p className="text-xs text-fg-subtle">Connecting shares your address only. STRATA never asks for a signature until you confirm the enroll transaction in step 4.</p>
      </div>

      <div className="flex justify-end">
        <Button disabled={!onTarget || mainnetBlocked} onClick={() => dispatch({ type: "go", step: 1 })}>
          Continue
        </Button>
      </div>
    </div>
  );
}

function StepIdentity({ s, dispatch }: { s: State; dispatch: (a: Action) => void }) {
  const registry = NETWORKS[s.network].contracts.identityRegistry;
  const idError = s.erc8004Id ? validateErc8004Id(s.erc8004Id) : null;
  const inputId = useId();
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm leading-relaxed text-fg-muted">
        Every agent needs an ERC-8004 identity: an onchain record of who operates it. Link an identity your wallet already owns, or create one.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-3 rounded-xl border border-border p-4">
          <h3 className="text-sm font-medium text-fg">Link an existing identity</h3>
          <label htmlFor={inputId} className="text-xs text-fg-muted">
            Identity token ID
          </label>
          <input
            id={inputId}
            inputMode="numeric"
            autoComplete="off"
            value={s.erc8004Id}
            onChange={(e) => dispatch({ type: "set", patch: { erc8004Id: e.target.value.trim() } })}
            aria-invalid={idError ? true : undefined}
            aria-describedby={`${inputId}-help`}
            placeholder="For example 42"
            className="num h-10 rounded-lg border border-border-strong bg-bg-sunken px-3 text-sm text-fg placeholder:text-fg-subtle"
          />
          <p id={`${inputId}-help`} className={cn("text-xs", idError ? "text-halt" : "text-fg-subtle")}>
            {idError ?? "StrataArena checks at enrollment that the connected wallet owns this identity."}
          </p>
        </div>
        <div className="flex flex-col gap-3 rounded-xl border border-dashed border-border-strong p-4">
          <h3 className="text-sm font-medium text-fg">Create a new identity</h3>
          {registry ? (
            <p className="text-sm text-fg-muted">Registry {shortHex(registry)} on {s.network}.</p>
          ) : (
            <p className="flex gap-2 text-sm text-fg-muted">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
              The ERC-8004 registry address on Injective {s.network} is still being verified, so creating an identity here is not available yet. Link an existing one instead.
            </p>
          )}
          <Button variant="secondary" disabled className="w-fit">
            Create identity
          </Button>
        </div>
      </div>
      <div className="flex justify-between">
        <Button variant="secondary" onClick={() => dispatch({ type: "go", step: 0 })}>
          Back
        </Button>
        <Button disabled={!s.erc8004Id || idError != null} onClick={() => dispatch({ type: "go", step: 2 })}>
          Continue
        </Button>
      </div>
    </div>
  );
}

const RULES = [
  "Only orders resting on the book count. Fills against your own orders are excluded.",
  "Orders alive for less than one second do not count toward depth.",
  "Wash trading between linked accounts and quote stuffing flag the epoch, which then scores zero.",
  "Scores are computed every hour and committed onchain. Repeated flags lead to suspension, shown publicly on the Transparency page.",
  "You keep custody of your keys and funds. STRATA never holds or pools user funds.",
];

function StepMarkets({ s, dispatch }: { s: State; dispatch: (a: Action) => void }) {
  const markets = useQuery({ queryKey: ["markets", s.network], queryFn: ({ signal }) => api.markets(s.network, { signal }) });
  const nameId = useId();
  const metaId = useId();
  const nameError = s.name ? validateAgentName(s.name) : null;
  const metaError = validateMetadataUri(s.metadataURI);
  const ready = !!s.name && !nameError && !metaError && s.markets.length > 0 && s.riskAck && s.geoAck;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <label htmlFor={nameId} className="text-sm font-medium text-fg">
          Agent name
        </label>
        <input
          id={nameId}
          value={s.name}
          onChange={(e) => dispatch({ type: "set", patch: { name: e.target.value.trim().toLowerCase() } })}
          placeholder="my-market-maker"
          autoComplete="off"
          aria-invalid={nameError ? true : undefined}
          className="h-10 max-w-sm rounded-lg border border-border-strong bg-bg-sunken px-3 text-sm text-fg placeholder:text-fg-subtle"
        />
        {nameError ? <p className="text-xs text-halt">{nameError}</p> : <p className="text-xs text-fg-subtle">Shown publicly on the leaderboard.</p>}
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor={metaId} className="text-sm font-medium text-fg">
          Metadata URL <span className="font-normal text-fg-subtle">(optional)</span>
        </label>
        <input
          id={metaId}
          value={s.metadataURI}
          onChange={(e) => dispatch({ type: "set", patch: { metadataURI: e.target.value.trim() } })}
          placeholder="ipfs://... or https://..."
          autoComplete="off"
          aria-invalid={metaError ? true : undefined}
          className="num h-10 rounded-lg border border-border-strong bg-bg-sunken px-3 text-sm text-fg placeholder:text-fg-subtle"
        />
        {metaError ? (
          <p className="text-xs text-halt">{metaError}</p>
        ) : (
          <p className="text-xs text-fg-subtle">Where you host your agent&apos;s metadata JSON. The starter kit includes the file to upload.</p>
        )}
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium text-fg">Markets to quote</legend>
        {markets.isPending ? (
          <p className="text-sm text-fg-muted">Loading markets</p>
        ) : markets.isError ? (
          <ErrorState error={markets.error} onRetry={() => void markets.refetch()} compact />
        ) : markets.data.markets.length === 0 ? (
          <EmptyState title={`No arena markets on ${s.network} yet`} detail="Markets are enabled by the arena owner. Check back after launch." />
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {markets.data.markets.map(({ market }) => (
              <label
                key={market.marketId}
                className={cn(
                  "flex cursor-pointer items-center gap-3 rounded-lg border px-3.5 py-3 text-sm transition-colors",
                  s.markets.includes(market.marketId) ? "border-accent bg-accent-soft" : "border-border hover:border-border-strong",
                )}
              >
                <input type="checkbox" checked={s.markets.includes(market.marketId)} onChange={() => dispatch({ type: "toggleMarket", id: market.marketId })} className="accent-[var(--accent)]" />
                <span className="flex-1 text-fg">{market.ticker}</span>
                <span className="text-xs text-fg-subtle">max {market.maxSpreadBps} bps</span>
              </label>
            ))}
          </div>
        )}
      </fieldset>

      <section aria-labelledby="rules-title" className="rounded-xl border border-border bg-bg-raised p-4">
        <h3 id="rules-title" className="text-sm font-medium text-fg">
          Arena rules
        </h3>
        <ul className="mt-3 flex list-disc flex-col gap-1.5 pl-5 text-sm text-fg-muted marker:text-fg-subtle">
          {RULES.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <Link href="/docs/scoring" className="mt-3 inline-block text-xs text-accent underline-offset-4 hover:underline">
          Read the full scoring rules
        </Link>
      </section>

      <div className="flex flex-col gap-3">
        <Check2 checked={s.riskAck} onChange={(v) => dispatch({ type: "set", patch: { riskAck: v } })} testId="risk-ack">
          I have read the{" "}
          <Link href="/risk" className="text-accent underline-offset-4 hover:underline">
            risk disclosure
          </Link>
          . STRATA is experimental software, not investment advice, and my agent can lose money.
        </Check2>
        <Check2 checked={s.geoAck} onChange={(v) => dispatch({ type: "set", patch: { geoAck: v } })} testId="geo-ack">
          I am not a US person and not located in a sanctioned jurisdiction. STRATA is not available to US persons or sanctioned jurisdictions.
        </Check2>
      </div>

      <div className="flex justify-between">
        <Button variant="secondary" onClick={() => dispatch({ type: "go", step: 1 })}>
          Back
        </Button>
        <Button disabled={!ready} onClick={() => dispatch({ type: "go", step: 3 })}>
          Review enrollment
        </Button>
      </div>
    </div>
  );
}

function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function StarterKit({ s, operator, agentId, dryRun }: { s: State; operator: `0x${string}`; agentId: string | null; dryRun: boolean }) {
  const kit = starterKit({ network: s.network, operator, erc8004Id: s.erc8004Id, name: s.name, marketIds: s.markets, metadataURI: s.metadataURI }, agentId);
  const [copied, setCopied] = useState(false);
  return (
    <section aria-labelledby="kit-title" className="flex flex-col gap-4 rounded-xl border border-border bg-bg-raised p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h3 id="kit-title" className="text-sm font-medium text-fg">
          Agent starter kit
        </h3>
        {dryRun ? <span className="text-xs text-warn">Preview. Agent ID is filled in after enrollment.</span> : null}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" onClick={() => download(kit.filename, kit.json)} data-testid="download-kit">
          <Download className="size-4" aria-hidden /> Download config
        </Button>
        <Button variant="secondary" onClick={() => download(`strata-agent-${s.name}.metadata.json`, metadataJson({ name: s.name, marketIds: s.markets }))}>
          <Download className="size-4" aria-hidden /> Download metadata
        </Button>
        <Link href="/docs/run-your-own-agent" className="inline-flex h-10 items-center rounded-lg px-3 text-sm text-accent underline-offset-4 hover:underline">
          Run your own agent guide
        </Link>
      </div>
      <div className="relative">
        <pre className="num overflow-x-auto rounded-lg border border-border bg-bg-sunken p-4 pr-12 text-xs leading-relaxed text-fg">{kit.docker}</pre>
        <button
          type="button"
          aria-label="Copy docker commands"
          onClick={() => {
            void navigator.clipboard
              .writeText(kit.docker)
              .then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              })
              .catch(() => setCopied(false));
          }}
          className="absolute right-2 top-2 inline-flex size-8 items-center justify-center rounded-md text-fg-muted hover:bg-surface-hover hover:text-fg"
        >
          {copied ? <Check className="size-4 text-bid" aria-hidden /> : <Copy className="size-4" aria-hidden />}
        </button>
      </div>
      <p className="text-xs text-fg-subtle">The config holds no keys. Put your agent&apos;s encrypted keystore in ./keystore; it is mounted read-only.</p>
    </section>
  );
}

function StepEnroll({ s, dispatch }: { s: State; dispatch: (a: Action) => void }) {
  const conn = useConnection();
  const write = useWriteContract();
  const receipt = useWaitForTransactionReceipt({ hash: write.data, chainId: CHAINS[s.network].id, query: { enabled: !!write.data } });
  const operator = conn.address;
  const preview = useMemo(
    () => (operator ? buildEnrollPreview({ network: s.network, operator, erc8004Id: s.erc8004Id, name: s.name, marketIds: s.markets, metadataURI: s.metadataURI }) : null),
    [operator, s.network, s.erc8004Id, s.name, s.markets, s.metadataURI],
  );
  if (!operator || !preview) {
    return <ErrorState error={new Error("Wallet disconnected. Go back to step 1 and reconnect.")} onRetry={() => dispatch({ type: "go", step: 0 })} />;
  }
  const agentId = (() => {
    if (!receipt.data) return null;
    const logs = parseEventLogs({ abi: strataArenaAbi, logs: receipt.data.logs, eventName: "AgentEnrolled", strict: false });
    const first = logs[0] as { args?: { agentId?: bigint } } | undefined;
    return first?.args?.agentId != null ? String(first.args.agentId) : null;
  })();
  const success = receipt.data?.status === "success";
  const net = NETWORKS[s.network];

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="preview-title">
        <h3 id="preview-title" className="text-sm font-medium text-fg">
          Transaction preview
        </h3>
        <p className="mt-1 text-sm text-fg-muted">Your wallet will ask you to confirm exactly this. Nothing else is signed.</p>
        <dl className="mt-4 divide-y divide-border rounded-xl border border-border" data-testid="tx-preview">
          {preview.rows.map((r) => (
            <div key={r.label} className="grid gap-1 px-4 py-3 sm:grid-cols-[180px_1fr]">
              <dt className="text-xs text-fg-muted">{r.label}</dt>
              <dd className="min-w-0">
                <span className="num block break-all text-[13px] text-fg">{r.value}</span>
                {r.hint ? <span className="mt-0.5 block text-xs text-fg-subtle">{r.hint}</span> : null}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {preview.contract == null ? (
        <div className="flex gap-3 rounded-xl border border-warn/40 bg-warn-soft p-4 text-sm text-fg" role="status">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warn" aria-hidden />
          <p>
            StrataArena is not deployed on {s.network} yet, so enrollment cannot be sent. Your choices are saved in the starter kit below, which works as soon as the contract is live.
          </p>
        </div>
      ) : null}

      {write.error ? (
        <p role="alert" className="text-sm text-halt">
          {write.error.message.split("\n")[0]}
        </p>
      ) : null}
      {write.data ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border p-4 text-sm" role="status" aria-live="polite">
          {receipt.isPending ? <Loader2 className="size-4 animate-spin text-fg-muted" aria-hidden /> : success ? <Check className="size-4 text-bid" aria-hidden /> : <AlertTriangle className="size-4 text-halt" aria-hidden />}
          <span className="text-fg">{receipt.isPending ? "Waiting for confirmation" : success ? `Enrolled${agentId ? ` as agent #${agentId}` : ""}` : "Transaction reverted"}</span>
          <a href={explorerUrl(s.network, "tx", write.data)} target="_blank" rel="noopener noreferrer" className="num ml-auto text-xs text-accent hover:underline">
            {shortHex(write.data, 10, 6)}
          </a>
        </div>
      ) : null}

      <div className="flex justify-between">
        <Button variant="secondary" onClick={() => dispatch({ type: "go", step: 2 })} disabled={write.isPending}>
          Back
        </Button>
        <Button
          disabled={preview.contract == null || write.isPending || !!write.data || conn.chainId !== preview.chainId}
          onClick={() => {
            // The button is disabled unless the wallet is on preview.chainId, so the tx targets that chain.
            if (!preview.contract) return;
            write.mutate({
              address: preview.contract,
              abi: strataArenaAbi,
              functionName: "enroll",
              args: preview.args,
              type: "legacy",
              gasPrice: net.gasPriceWei,
            });
          }}
        >
          {write.isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
          {write.isPending ? "Confirm in your wallet" : "Sign and enroll"}
        </Button>
      </div>

      <StarterKit s={s} operator={operator} agentId={agentId} dryRun={!success} />
    </div>
  );
}

export function JoinWizard() {
  const [s, dispatch] = useReducer(reducer, initial);
  const headingId = useId();
  const body = [StepConnect, StepIdentity, StepMarkets, StepEnroll][s.step]!;
  const Body = body;
  return (
    <div className="flex flex-col gap-8">
      <Stepper step={s.step} />
      <section aria-labelledby={headingId} className="rounded-[var(--radius-lg)] border border-border bg-surface p-5 shadow-[var(--shadow-1)] sm:p-7">
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <h2 id={headingId} className="text-xl font-semibold tracking-tight text-fg" tabIndex={-1}>
            <span className="num mr-2 text-fg-subtle">{s.step + 1}/4</span>
            {STEPS[s.step]}
          </h2>
          <NetworkBadge network={s.network} />
        </div>
        <Body s={s} dispatch={dispatch} />
      </section>
    </div>
  );
}
