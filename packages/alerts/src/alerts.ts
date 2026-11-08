import type { GuardReason, NetworkName } from "@strata/sdk";

/** The five owner alerts required by PRD 15.3. */
export type Alert =
  | {
      readonly kind: "agent_halt";
      readonly network: NetworkName;
      readonly agent: string;
      readonly reason: GuardReason;
      readonly detail: string;
    }
  | {
      readonly kind: "daily_loss_limit";
      readonly network: NetworkName;
      readonly agent: string;
      readonly lossUsd: number;
      readonly limitUsd: number;
    }
  | {
      readonly kind: "tx_failure_spike";
      readonly network: NetworkName;
      readonly service: string;
      readonly failures: number;
      readonly total: number;
      readonly windowSec: number;
      readonly lastError: string | null;
    }
  | {
      readonly kind: "epoch_post_failure";
      readonly network: NetworkName;
      readonly season: number;
      readonly epoch: number;
      readonly attempt: number;
      readonly error: string;
    }
  | {
      readonly kind: "data_lag";
      readonly network: NetworkName;
      readonly source: string;
      readonly lagSec: number;
      readonly thresholdSec: number;
    };

export type AlertKind = Alert["kind"];

const MAX_ERROR_CHARS = 300;

/** Errors can echo request bodies or URLs; cap length and strip anything token shaped. */
export function sanitizeErrorText(text: string): string {
  const redacted = text
    .replace(/\d{6,}:[A-Za-z0-9_-]{30,}/g, "[redacted-bot-token]")
    .replace(/\b0x[0-9a-fA-F]{64}\b/g, "[redacted-hex32]")
    .replace(/\s+/g, " ")
    .trim();
  return redacted.length > MAX_ERROR_CHARS ? `${redacted.slice(0, MAX_ERROR_CHARS)}...` : redacted;
}

const usd = (n: number): string => `$${n.toFixed(2)}`;

/**
 * Stable key used to throttle repeats of the same condition. Two halts of one agent for
 * different reasons are distinct alerts; the same halt repeating every cycle is not.
 */
export function alertKey(alert: Alert): string {
  switch (alert.kind) {
    case "agent_halt":
      return `${alert.network}:halt:${alert.agent}:${alert.reason}`;
    case "daily_loss_limit":
      return `${alert.network}:daily_loss:${alert.agent}`;
    case "tx_failure_spike":
      return `${alert.network}:tx_spike:${alert.service}`;
    case "epoch_post_failure":
      return `${alert.network}:epoch_post:${alert.season}:${alert.epoch}`;
    case "data_lag":
      return `${alert.network}:data_lag:${alert.source}`;
  }
}

/** Plain text, no markdown parse mode, so agent-supplied strings cannot inject formatting. */
export function formatAlert(alert: Alert, at: Date): string {
  const head = `STRATA ${alert.network.toUpperCase()}`;
  const stamp = at.toISOString();
  switch (alert.kind) {
    case "agent_halt":
      return [`${head}: agent HALT`, `Agent: ${alert.agent}`, `Reason: ${alert.reason}`, `Detail: ${sanitizeErrorText(alert.detail)}`, stamp].join("\n");
    case "daily_loss_limit":
      return [
        `${head}: daily loss limit hit`,
        `Agent: ${alert.agent}`,
        `Loss today: ${usd(alert.lossUsd)} (limit ${usd(alert.limitUsd)})`,
        "Agent stops quoting until the next UTC day.",
        stamp,
      ].join("\n");
    case "tx_failure_spike": {
      const pct = alert.total > 0 ? Math.round((alert.failures / alert.total) * 100) : 0;
      const lines = [
        `${head}: tx failure spike`,
        `Service: ${alert.service}`,
        `Failed: ${alert.failures} of ${alert.total} (${pct}%) in the last ${alert.windowSec}s`,
      ];
      if (alert.lastError !== null) lines.push(`Last error: ${sanitizeErrorText(alert.lastError)}`);
      lines.push(stamp);
      return lines.join("\n");
    }
    case "epoch_post_failure":
      return [
        `${head}: epoch post failed`,
        `Season ${alert.season}, epoch ${alert.epoch}, attempt ${alert.attempt}`,
        `Error: ${sanitizeErrorText(alert.error)}`,
        stamp,
      ].join("\n");
    case "data_lag":
      return [
        `${head}: data lag`,
        `Source: ${alert.source}`,
        `Lag: ${Math.round(alert.lagSec)}s (threshold ${alert.thresholdSec}s)`,
        stamp,
      ].join("\n");
  }
}
