-- Migration: Store KeeperHub run metadata for material on-chain writes
-- @requires-db-prep
--
-- Every material write (publishAlert, publishDigest, createSponsoredWatch,
-- publishSponsoredReport, payout transfers, recordPayout) stores:
--   keeper_hub_run_id  — KeeperHub execution / run id
--   explorer_url       — block explorer URL for the transaction

-- ── daily_digests ───────────────────────────────────────
ALTER TABLE public.daily_digests
  ADD COLUMN IF NOT EXISTS keeper_hub_run_id TEXT,
  ADD COLUMN IF NOT EXISTS explorer_url TEXT;

-- ── public_alerts ───────────────────────────────────────
ALTER TABLE public.public_alerts
  ADD COLUMN IF NOT EXISTS keeper_hub_run_id TEXT,
  ADD COLUMN IF NOT EXISTS explorer_url TEXT;

-- ── sponsored_watches ───────────────────────────────────
ALTER TABLE public.sponsored_watches
  ADD COLUMN IF NOT EXISTS create_keeper_hub_run_id TEXT,
  ADD COLUMN IF NOT EXISTS create_explorer_url TEXT,
  ADD COLUMN IF NOT EXISTS report_keeper_hub_run_id TEXT,
  ADD COLUMN IF NOT EXISTS report_explorer_url TEXT;

-- ── payout_records ──────────────────────────────────────
ALTER TABLE public.payout_records
  ADD COLUMN IF NOT EXISTS keeper_hub_run_id TEXT,
  ADD COLUMN IF NOT EXISTS explorer_url TEXT,
  ADD COLUMN IF NOT EXISTS transfer_keeper_hub_run_id TEXT,
  ADD COLUMN IF NOT EXISTS transfer_explorer_url TEXT;

CREATE INDEX IF NOT EXISTS idx_daily_digests_keeper_hub_run
  ON public.daily_digests (keeper_hub_run_id)
  WHERE keeper_hub_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_public_alerts_keeper_hub_run
  ON public.public_alerts (keeper_hub_run_id)
  WHERE keeper_hub_run_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payout_records_keeper_hub_run
  ON public.payout_records (keeper_hub_run_id)
  WHERE keeper_hub_run_id IS NOT NULL;
