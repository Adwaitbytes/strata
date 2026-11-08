/**
 * Prometheus metrics for the scorer (PRD 15.3: alert on epoch post failure).
 * A handful of counters and gauges does not justify a client library, so this renders the
 * text exposition format directly.
 */
import { createServer, type Server } from "node:http";
import type { NetworkName } from "@strata/sdk";

interface Series {
  help: string;
  type: "counter" | "gauge";
  value: number;
}

export interface ScorerMetrics {
  epochPosted(epoch: number): void;
  epochPostFailed(): void;
  epochSkipped(): void;
  rootMismatch(): void;
  tickCompleted(atMs: number): void;
  render(): string;
}

export function createScorerMetrics(network: NetworkName): ScorerMetrics {
  const series: Record<string, Series> = {
    strata_scorer_epochs_posted_total: { help: "Epoch roots confirmed onchain.", type: "counter", value: 0 },
    strata_scorer_epoch_post_failures_total: { help: "Failed attempts to post an epoch root (alert on increase).", type: "counter", value: 0 },
    strata_scorer_epochs_skipped_total: { help: "Epochs not attested, with the reason recorded in epoch_runs.", type: "counter", value: 0 },
    strata_scorer_root_mismatch_total: { help: "Epochs where the onchain root differs from the recomputed one.", type: "counter", value: 0 },
    strata_scorer_last_posted_epoch: { help: "Most recent epoch confirmed onchain in the current season.", type: "gauge", value: -1 },
    strata_scorer_last_tick_timestamp_seconds: { help: "Unix time of the last completed scheduler tick.", type: "gauge", value: 0 },
  };
  const s = (name: keyof typeof series) => series[name]!;
  return {
    epochPosted(epoch) {
      s("strata_scorer_epochs_posted_total").value++;
      s("strata_scorer_last_posted_epoch").value = epoch;
    },
    epochPostFailed() {
      s("strata_scorer_epoch_post_failures_total").value++;
    },
    epochSkipped() {
      s("strata_scorer_epochs_skipped_total").value++;
    },
    rootMismatch() {
      s("strata_scorer_root_mismatch_total").value++;
    },
    tickCompleted(atMs) {
      s("strata_scorer_last_tick_timestamp_seconds").value = Math.floor(atMs / 1_000);
    },
    render() {
      return (
        Object.entries(series)
          .map(([name, m]) => `# HELP ${name} ${m.help}\n# TYPE ${name} ${m.type}\n${name}{network="${network}"} ${m.value}`)
          .join("\n") + "\n"
      );
    },
  };
}

export function serveMetrics(port: number, metrics: ScorerMetrics, healthy: () => boolean): Server {
  const server = createServer((req, res) => {
    if (req.url === "/metrics") {
      res.writeHead(200, { "content-type": "text/plain; version=0.0.4" });
      res.end(metrics.render());
    } else if (req.url === "/healthz") {
      const ok = healthy();
      res.writeHead(ok ? 200 : 503, { "content-type": "text/plain" });
      res.end(ok ? "ok\n" : "stale\n");
    } else {
      res.writeHead(404).end();
    }
  });
  server.listen(port);
  return server;
}
