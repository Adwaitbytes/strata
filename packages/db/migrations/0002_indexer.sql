-- STRATA migration 0002 (W4 indexer, PRD 11.1). Additive only.

-- Raw StrataArena / ScoreAttestor logs from Blockscout. (network, tx_hash, log_index) makes every
-- poll, restart and backfill an idempotent upsert.
CREATE TABLE arena_events (
  network network NOT NULL, contract text NOT NULL, tx_hash text NOT NULL, log_index integer NOT NULL,
  block_number bigint NOT NULL, block_time timestamptz NOT NULL, event text NOT NULL, args jsonb NOT NULL,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (network, tx_hash, log_index));
CREATE INDEX arena_events_block_idx ON arena_events (network, contract, block_number);

-- Resume points for pollers and backfills (Blockscout block height, trade pagination, etc).
CREATE TABLE indexer_cursors (
  network network NOT NULL, source text NOT NULL, cursor jsonb NOT NULL, updated_at timestamptz NOT NULL,
  PRIMARY KEY (network, source));

-- Agent position samples from the Indexer positions stream.
CREATE TABLE agent_positions (
  network network NOT NULL, agent_id integer NOT NULL, market_id text NOT NULL, at timestamptz NOT NULL,
  direction text NOT NULL, quantity numeric NOT NULL, entry_price numeric NOT NULL, margin numeric NOT NULL,
  mark_price numeric, provenance provenance NOT NULL,
  PRIMARY KEY (network, agent_id, market_id, at));
SELECT strata_hypertable('agent_positions', 'at', INTERVAL '7 days');

CREATE INDEX trades_subaccount_idx ON trades (network, subaccount_id, executed_at DESC);
CREATE INDEX agents_subaccount_idx ON agents (network, subaccount_id);
