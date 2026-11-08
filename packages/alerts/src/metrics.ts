/**
 * Prometheus metric names that the Grafana dashboards and alert rules in `infra/` query.
 * Services that emit these (agent, indexer, scorer) must use exactly these names and
 * labels; renaming one here means updating `infra/grafana/dashboards/*.json` and
 * `infra/prometheus/rules/*.yml` in the same change.
 */
export const METRICS = {
  /** histogram, labels: agent, network. One observation per quoting cycle. */
  agentCycleSeconds: "strata_agent_cycle_duration_seconds",
  /** counter, labels: service, network, result="success"|"failure". Every broadcast tx. */
  txTotal: "strata_tx_total",
  /** counter, labels: agent, network, guard, reason. Guard actions of type halt. */
  guardHaltsTotal: "strata_guard_halts_total",
  /** gauge 0/1, labels: agent, network. 1 while the agent is halted. */
  agentHalted: "strata_agent_halted",
  /** gauge, labels: agent, network, market. Signed net position notional in USD. */
  inventoryUsd: "strata_agent_inventory_usd",
  /** gauge, labels: agent, network, kind="realized"|"unrealized". PnL for the current UTC day. */
  pnlUsd: "strata_agent_pnl_usd",
  /** gauge, labels: agent, network. Subaccount margin ratio. */
  marginRatio: "strata_agent_margin_ratio",
  /** gauge, labels: service, network, source. Seconds since the newest datum from a source. */
  dataLagSeconds: "strata_data_lag_seconds",
  /** counter, labels: network. Emitted by services/scorer (W5 names, adopted as is). */
  epochsPostedTotal: "strata_scorer_epochs_posted_total",
  /** counter, labels: network. Failed epoch root posts. */
  epochPostFailuresTotal: "strata_scorer_epoch_post_failures_total",
  /** gauge, labels: network. Unix seconds of the scorer's last tick. */
  scorerLastTickTimestamp: "strata_scorer_last_tick_timestamp_seconds",
  /** counter, labels: service, kind, status. Telegram alert outcomes from NotifyResult. */
  alertsTotal: "strata_alerts_total",
} as const;

export type MetricName = (typeof METRICS)[keyof typeof METRICS];

/** Default port for `/metrics`, `/healthz` and (agents only) `/internal/kill`. */
export const DEFAULT_METRICS_PORT = 9464;
