-- Migration: Create sponsored_watches table
-- Tracks paid monitoring campaigns for target contracts

CREATE TABLE IF NOT EXISTS sponsored_watches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  target_contract TEXT NOT NULL,
  watch_spec_hash TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  create_tx_hash TEXT,
  report_tx_hash TEXT,
  report_content_hash TEXT,
  content_uri TEXT,
  status TEXT NOT NULL DEFAULT 'accepted' CHECK (status IN ('accepted', 'monitoring', 'completed', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for active campaigns by contract
CREATE INDEX IF NOT EXISTS idx_sponsored_watches_target_contract ON sponsored_watches(target_contract);
CREATE INDEX IF NOT EXISTS idx_sponsored_watches_status ON sponsored_watches(status);
CREATE INDEX IF NOT EXISTS idx_sponsored_watches_window ON sponsored_watches(starts_at, ends_at);
