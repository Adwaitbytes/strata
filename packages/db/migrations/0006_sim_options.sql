-- STRATA migration 0006 (options writer, additive). The options-writer agent (PRD 9.8) runs against
-- STRATA's simulator until Injective grants writer access (decision D9, docs/OPTIONS.md). These
-- tables hold only simulated data: every row is pinned to provenance SIMULATED by a CHECK, so no
-- reader can mistake them for chain activity. The scorer never reads them.

-- Every quote the writer priced, with the inputs that produced it and what the simulated buyer did.
CREATE TABLE IF NOT EXISTS sim_option_quotes (
  network network NOT NULL,
  provenance provenance NOT NULL CHECK (provenance = 'SIMULATED'),
  agent_id integer NOT NULL,
  quote_id text NOT NULL,
  underlying text NOT NULL,
  underlying_market_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('call', 'put')),
  strike numeric NOT NULL CHECK (strike > 0),
  expiry_at timestamptz NOT NULL,
  spot numeric NOT NULL,
  spot_source text NOT NULL,
  spot_ts timestamptz NOT NULL,
  size numeric NOT NULL CHECK (size > 0),
  delta double precision NOT NULL,
  realized_vol double precision NOT NULL,
  sigma_fair double precision NOT NULL,
  implied_vol double precision NOT NULL,
  fair_value numeric NOT NULL,
  premium numeric NOT NULL,
  collateral numeric NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('written', 'not_taken', 'rejected_collateral', 'rejected_limit')),
  at timestamptz NOT NULL,
  PRIMARY KEY (network, quote_id, at));
SELECT strata_hypertable('sim_option_quotes', 'at', INTERVAL '7 days');
CREATE INDEX IF NOT EXISTS sim_option_quotes_agent_idx ON sim_option_quotes (network, agent_id, at DESC);

-- Written options. Collateral covers the maximum payout and the payout can never exceed it.
CREATE TABLE IF NOT EXISTS sim_option_positions (
  network network NOT NULL,
  provenance provenance NOT NULL CHECK (provenance = 'SIMULATED'),
  agent_id integer NOT NULL,
  position_id text NOT NULL,
  underlying text NOT NULL,
  underlying_market_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('call', 'put')),
  strike numeric NOT NULL CHECK (strike > 0),
  expiry_at timestamptz NOT NULL,
  size numeric NOT NULL CHECK (size > 0),
  premium numeric NOT NULL CHECK (premium >= 0),
  collateral numeric NOT NULL CHECK (collateral > 0),
  status text NOT NULL CHECK (status IN ('open', 'settled', 'closed_early')),
  payout numeric CHECK (payout >= 0 AND payout <= collateral),
  settlement_price numeric,
  settled_on_stale_oracle boolean NOT NULL DEFAULT false,
  opened_at timestamptz NOT NULL,
  closed_at timestamptz,
  PRIMARY KEY (network, position_id));
CREATE INDEX IF NOT EXISTS sim_option_positions_agent_idx ON sim_option_positions (network, agent_id, status);

-- Book snapshots per cycle: cash, collateral and PnL of the simulated writer.
CREATE TABLE IF NOT EXISTS sim_option_book (
  network network NOT NULL,
  provenance provenance NOT NULL CHECK (provenance = 'SIMULATED'),
  agent_id integer NOT NULL,
  at timestamptz NOT NULL,
  cash numeric NOT NULL,
  locked_collateral numeric NOT NULL CHECK (locked_collateral >= 0),
  free_cash numeric NOT NULL,
  premium_collected numeric NOT NULL,
  realized_pnl numeric NOT NULL,
  unrealized_pnl numeric NOT NULL,
  equity numeric NOT NULL,
  open_positions integer NOT NULL,
  PRIMARY KEY (network, agent_id, at));
SELECT strata_hypertable('sim_option_book', 'at', INTERVAL '7 days');
