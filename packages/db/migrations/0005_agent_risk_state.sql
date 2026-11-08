-- STRATA migration 0005 (W2 risk engine, additive). Persisted Risk Governor and kill-switch latch
-- per agent (security review H-2): a restart must not clear a daily-loss stop, a season-drawdown
-- stop, the peak equity used for drawdown, or a kill. Only a human clears a stop (clear-stops CLI).
CREATE TABLE IF NOT EXISTS agent_risk_state (
  network network NOT NULL,
  agent_id integer NOT NULL,
  state jsonb NOT NULL,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (network, agent_id)
);
