-- STRATA migration 0001 (PRD 19.5). Requires TimescaleDB.
CREATE EXTENSION IF NOT EXISTS timescaledb;

CREATE TYPE network AS ENUM ('mainnet', 'testnet');
CREATE TYPE provenance AS ENUM ('LIVE', 'TESTNET', 'SIMULATED', 'BACKTEST', 'BASELINE', 'MOCK');

CREATE TABLE markets (
  network network NOT NULL, market_id text NOT NULL, ticker text NOT NULL, data jsonb NOT NULL,
  arena_enabled boolean NOT NULL DEFAULT false, fetched_at timestamptz NOT NULL,
  PRIMARY KEY (network, market_id));

CREATE TABLE agents (
  network network NOT NULL, agent_id integer NOT NULL, name text NOT NULL, kind text NOT NULL,
  operator text NOT NULL, inj_address text NOT NULL, subaccount_id text NOT NULL, erc8004_id text,
  metadata_uri text NOT NULL DEFAULT '', market_ids jsonb NOT NULL, status text NOT NULL,
  status_reason text, simulated boolean NOT NULL DEFAULT false, enrolled_at timestamptz NOT NULL,
  PRIMARY KEY (network, agent_id));

CREATE TABLE book_snapshots (
  network network NOT NULL, market_id text NOT NULL, at timestamptz NOT NULL, provenance provenance NOT NULL,
  mid numeric, spread_bps double precision, depth_usd_25 double precision NOT NULL,
  strata_depth_usd_25 double precision NOT NULL, bids jsonb NOT NULL, asks jsonb NOT NULL,
  oracle_price numeric, oracle_ts timestamptz, session_state text NOT NULL,
  PRIMARY KEY (network, market_id, at));
SELECT create_hypertable('book_snapshots', 'at', chunk_time_interval => INTERVAL '1 day');

CREATE TABLE trades (
  network network NOT NULL, market_id text NOT NULL, trade_id text NOT NULL, executed_at timestamptz NOT NULL,
  price numeric NOT NULL, quantity numeric NOT NULL, side text NOT NULL, subaccount_id text NOT NULL,
  is_maker boolean NOT NULL, fee numeric NOT NULL,
  PRIMARY KEY (network, trade_id, executed_at));
SELECT create_hypertable('trades', 'executed_at', chunk_time_interval => INTERVAL '1 day');

CREATE TABLE agent_orders (
  network network NOT NULL, agent_id integer NOT NULL, market_id text NOT NULL, order_hash text NOT NULL,
  side text NOT NULL, price numeric NOT NULL, quantity numeric NOT NULL, level integer NOT NULL,
  posted_at timestamptz NOT NULL, cancelled_at timestamptz, provenance provenance NOT NULL,
  PRIMARY KEY (network, order_hash, posted_at));
SELECT create_hypertable('agent_orders', 'posted_at', chunk_time_interval => INTERVAL '1 day');
CREATE INDEX agent_orders_agent_idx ON agent_orders (network, agent_id, posted_at DESC);

CREATE TABLE agent_fills (
  network network NOT NULL, agent_id integer NOT NULL, market_id text NOT NULL, order_hash text NOT NULL,
  trade_id text NOT NULL, tx_hash text NOT NULL, event_index integer NOT NULL, side text NOT NULL,
  price numeric NOT NULL, quantity numeric NOT NULL, fee_usd double precision NOT NULL, is_maker boolean NOT NULL,
  counterparty_subaccount_id text, executed_at timestamptz NOT NULL, provenance provenance NOT NULL,
  PRIMARY KEY (network, tx_hash, event_index, executed_at));
SELECT create_hypertable('agent_fills', 'executed_at', chunk_time_interval => INTERVAL '1 day');

CREATE TABLE oracle_prices (
  network network NOT NULL, market_id text NOT NULL, source text NOT NULL, at timestamptz NOT NULL,
  price numeric NOT NULL, oracle_ts timestamptz NOT NULL,
  PRIMARY KEY (network, market_id, source, at));
SELECT create_hypertable('oracle_prices', 'at', chunk_time_interval => INTERVAL '1 day');

CREATE TABLE guard_events (
  id text NOT NULL, network network NOT NULL, provenance provenance NOT NULL, agent_id integer NOT NULL,
  market_id text, guard text NOT NULL, action text NOT NULL, reason text NOT NULL, detail text NOT NULL,
  observed jsonb NOT NULL, at timestamptz NOT NULL,
  PRIMARY KEY (id, at));
SELECT create_hypertable('guard_events', 'at', chunk_time_interval => INTERVAL '7 days');

CREATE TABLE tuner_events (
  id text NOT NULL, network network NOT NULL, agent_id integer NOT NULL, market_id text NOT NULL,
  mode text NOT NULL, model text NOT NULL, payload jsonb NOT NULL, at timestamptz NOT NULL,
  PRIMARY KEY (id, at));
SELECT create_hypertable('tuner_events', 'at', chunk_time_interval => INTERVAL '7 days');

CREATE TABLE epochs (
  network network NOT NULL, season integer NOT NULL, epoch integer NOT NULL,
  start_time timestamptz NOT NULL, end_time timestamptz NOT NULL, merkle_root text NOT NULL,
  data_uri text NOT NULL, tx_hash text, posted_at timestamptz, contract text NOT NULL,
  PRIMARY KEY (network, season, epoch));

CREATE TABLE scores (
  network network NOT NULL, season integer NOT NULL, epoch integer NOT NULL, agent_id integer NOT NULL,
  score integer NOT NULL, metrics jsonb NOT NULL, flags bigint NOT NULL, leaf text NOT NULL,
  proof jsonb NOT NULL, provenance provenance NOT NULL,
  PRIMARY KEY (network, season, epoch, agent_id));

CREATE TABLE heartbeats (
  network network NOT NULL, service text NOT NULL, at timestamptz NOT NULL, detail jsonb NOT NULL,
  PRIMARY KEY (network, service));

CREATE TABLE admin_nonces (nonce text PRIMARY KEY, used_at timestamptz NOT NULL);
