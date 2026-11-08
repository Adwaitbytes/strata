"use client";

import { NETWORKS } from "@strata/config";
import type { EpochScore, NetworkName } from "@strata/sdk";
import { CheckCircle2, CircleDashed, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { useState } from "react";
import { api, describeError } from "@/lib/api/client";
import { explorerUrl } from "@/lib/chains";
import { shortHex } from "@/lib/format";
import type { CheckResult } from "@/lib/verify";
import { cn } from "@/lib/utils";

type Step = { key: "local" | "onchain"; title: string; result: CheckResult | "running" | "idle" };

function StepIcon({ r }: { r: Step["result"] }) {
  if (r === "running") return <Loader2 className="size-4 animate-spin text-fg-muted" aria-hidden />;
  if (r === "idle") return <CircleDashed className="size-4 text-fg-subtle" aria-hidden />;
  if (r.status === "pass") return <CheckCircle2 className="size-4 text-bid" aria-hidden />;
  if (r.status === "fail") return <XCircle className="size-4 text-halt" aria-hidden />;
  return <CircleDashed className="size-4 text-warn" aria-hidden />;
}

const STATUS_TEXT = { pass: "Passed", fail: "Failed", unavailable: "Not available" } as const;

/**
 * Checks this agent's score for one epoch in the browser: once against the merkle root the API
 * published, once against the ScoreAttestor contract. Read-only; no wallet is involved.
 */
export function VerifyScore({ scores, network }: { scores: EpochScore[]; network: NetworkName }) {
  const sorted = [...scores].sort((a, b) => b.epoch - a.epoch);
  const [epoch, setEpoch] = useState<number | null>(sorted[0]?.epoch ?? null);
  const [steps, setSteps] = useState<Step[]>([
    { key: "local", title: "Proof matches the published epoch root", result: "idle" },
    { key: "onchain", title: "ScoreAttestor confirms it onchain", result: "idle" },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [attestor, setAttestor] = useState<`0x${string}` | null>(null);
  const running = steps.some((s) => s.result === "running");

  const set = (key: Step["key"], result: Step["result"]) => setSteps((prev) => prev.map((s) => (s.key === key ? { ...s, result } : s)));

  async function run() {
    const score = sorted.find((s) => s.epoch === epoch);
    if (!score) return;
    setError(null);
    set("local", "running");
    set("onchain", "idle");
    try {
      // viem and the merkle code load only when someone asks to verify.
      const { verifyLocally, verifyOnchain } = await import("@/lib/verify");
      const [ep, transparency] = await Promise.all([
        api.epoch(network, score.season, score.epoch),
        api.transparency(network).catch(() => null),
      ]);
      set("local", verifyLocally(score, ep.attestation.merkleRoot as `0x${string}`));
      const address = (transparency?.contracts.attestor ?? NETWORKS[network].contracts.attestor) as `0x${string}` | null;
      setAttestor(address);
      set("onchain", "running");
      set("onchain", await verifyOnchain(score, network, address));
    } catch (err) {
      setError(describeError(err).detail);
      setSteps((prev) => prev.map((s) => (s.result === "running" ? { ...s, result: "idle" } : s)));
    }
  }

  if (sorted.length === 0) {
    return <p className="text-sm text-fg-muted">This agent has no scored epochs yet. Verification becomes available after its first epoch is attested.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm leading-relaxed text-fg-muted">
        Rebuilds this agent&apos;s merkle leaf from the published numbers and checks the proof, first locally and then against the contract. Runs in your browser, no wallet needed.
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1.5 text-xs text-fg-muted">
          Epoch
          <select
            value={epoch ?? ""}
            onChange={(e) => setEpoch(Number(e.target.value))}
            className="h-9 rounded-lg border border-border-strong bg-bg-sunken px-2.5 text-sm text-fg"
          >
            {sorted.map((s) => (
              <option key={s.epoch} value={s.epoch}>
                #{s.epoch} (season {s.season})
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => void run()}
          disabled={running}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-accent px-3.5 text-sm font-medium text-accent-fg transition-[filter,opacity] hover:brightness-110 disabled:opacity-60"
        >
          {running ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ShieldCheck className="size-4" aria-hidden />}
          Verify my score
        </button>
      </div>
      <ol className="flex flex-col gap-2" aria-live="polite">
        {steps.map((s) => (
          <li key={s.key} className="flex gap-3 rounded-lg border border-border bg-bg-raised px-3.5 py-3" data-testid={`verify-${s.key}`}>
            <span className="mt-0.5">
              <StepIcon r={s.result} />
            </span>
            <div className="min-w-0">
              <p className="text-sm text-fg">
                {s.title}
                {typeof s.result === "object" ? (
                  <span className={cn("ml-2 text-xs", s.result.status === "pass" ? "text-bid" : s.result.status === "fail" ? "text-halt" : "text-warn")}>
                    {STATUS_TEXT[s.result.status]}
                  </span>
                ) : null}
              </p>
              {typeof s.result === "object" ? <p className="mt-0.5 break-words text-xs text-fg-muted">{s.result.detail}</p> : null}
            </div>
          </li>
        ))}
      </ol>
      {attestor ? (
        <a href={explorerUrl(network, "address", attestor)} target="_blank" rel="noopener noreferrer" className="text-xs text-accent underline-offset-4 hover:underline">
          ScoreAttestor {shortHex(attestor)} on Blockscout
        </a>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-halt">
          {error}
        </p>
      ) : null}
    </div>
  );
}
