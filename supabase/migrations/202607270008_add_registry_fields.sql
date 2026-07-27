-- Migration: Add Chronicle Registry on-chain proof-of-publication fields
-- Date: 2026-07-27
-- @requires-db-prep

-- ── Add registry fields to daily_digests ────────────────
ALTER TABLE public.daily_digests
  ADD COLUMN IF NOT EXISTS registry_tx_hash TEXT,
  ADD COLUMN IF NOT EXISTS source_event_root TEXT,
  ADD COLUMN IF NOT EXISTS content_uri TEXT;

-- ── Add registry fields to public_alerts ────────────────
ALTER TABLE public.public_alerts
  ADD COLUMN IF NOT EXISTS registry_tx_hash TEXT,
  ADD COLUMN IF NOT EXISTS source_event_hash TEXT,
  ADD COLUMN IF NOT EXISTS content_uri TEXT;

-- ── Index for registry lookups ─────────────────────────
CREATE INDEX IF NOT EXISTS idx_daily_digests_registry_tx
  ON public.daily_digests (registry_tx_hash)
  WHERE registry_tx_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_public_alerts_registry_tx
  ON public.public_alerts (registry_tx_hash)
  WHERE registry_tx_hash IS NOT NULL;

-- ── Update execution_log action_type check ─────────────
-- Add registry_write and payout to the allowed action types
ALTER TABLE public.execution_logs
  DROP CONSTRAINT IF EXISTS execution_logs_action_type_check;

ALTER TABLE public.execution_logs
  ADD CONSTRAINT execution_logs_action_type_check
  CHECK (action_type IN (
    'monitor', 'generate_alert', 'publish_alert',
    'generate_digest', 'publish_digest',
    'payment', 'treasury_check', 'notification',
    'registry_write', 'payout'
  ));
