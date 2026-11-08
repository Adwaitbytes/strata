-- STRATA migration 0003 (W6 API, additive). Kill-switch commands accepted by POST /v1/admin/kill.
-- Agents poll rows newer than their cursor where target_agent_id IS NULL (all agents) or equals
-- their own id, and may LISTEN on channel 'strata_kill' (payload: command id) for low latency.
CREATE TABLE IF NOT EXISTS kill_commands (
  id text PRIMARY KEY,
  network network NOT NULL,
  target_agent_id integer,
  close_positions boolean NOT NULL,
  signer text NOT NULL,
  nonce text NOT NULL UNIQUE REFERENCES admin_nonces (nonce),
  requested_at timestamptz NOT NULL,
  signature_expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS kill_commands_network_requested_idx ON kill_commands (network, requested_at);
