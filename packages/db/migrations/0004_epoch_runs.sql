-- STRATA migration 0004 (W5 scorer, additive). One row per scored epoch: the scheduler cursor,
-- why an epoch was skipped, and the postEpoch tx being tracked, so a restart resumes without
-- ever posting the same epoch twice. `detail` holds flag evidence and the per-agent breakdown
-- for the Transparency page.
CREATE TABLE IF NOT EXISTS epoch_runs (
  network network NOT NULL, season integer NOT NULL, epoch integer NOT NULL,
  status text NOT NULL CHECK (status IN ('computed', 'submitted', 'posted', 'skipped', 'failed')),
  merkle_root text, data_uri text, document_hash text, tx_hash text, reason text,
  attempts integer NOT NULL DEFAULT 0, detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (network, season, epoch));
