-- Migration: Add ChronicleAI indexes and constraints
-- Date: 2026-07-27
-- @requires-db-prep

-- ── Unique Source-Event Constraint ──────────────────────
-- Prevents duplicate ingestion when source_event_id is provided
CREATE UNIQUE INDEX IF NOT EXISTS idx_monitored_events_source_unique
  ON public.monitored_events (source, source_event_id)
  WHERE source_event_id IS NOT NULL;

-- ── Alert Dedupe Key ───────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS idx_public_alerts_dedupe_key
  ON public.public_alerts (dedupe_key)
  WHERE dedupe_key IS NOT NULL;

-- ── Digest Reporting Window ────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS idx_daily_digests_report_window
  ON public.daily_digests (period_start, period_end);

-- ── Payment Challenge Lookup ────────────────────────────
CREATE INDEX IF NOT EXISTS idx_payment_records_challenge_ref
  ON public.payment_records (challenge_reference)
  WHERE challenge_reference IS NOT NULL;

-- ── Payment Settlement Lookup ───────────────────────────
CREATE INDEX IF NOT EXISTS idx_payment_records_settlement_ref
  ON public.payment_records (settlement_reference)
  WHERE settlement_reference IS NOT NULL;

-- ── Recent Dashboard Indexes ────────────────────────────
CREATE INDEX IF NOT EXISTS idx_monitored_events_created_at
  ON public.monitored_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_public_alerts_published_at
  ON public.public_alerts (published_at DESC)
  WHERE published_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_daily_digests_published_at
  ON public.daily_digests (published_at DESC)
  WHERE published_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_records_requested_at
  ON public.payment_records (requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_execution_logs_started_at
  ON public.execution_logs (started_at DESC);

-- ── Entity Lookup Indexes ──────────────────────────────
CREATE INDEX IF NOT EXISTS idx_execution_logs_entity
  ON public.execution_logs (entity_type, entity_id)
  WHERE entity_type IS NOT NULL AND entity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_public_alerts_monitored_event
  ON public.public_alerts (monitored_event_id)
  WHERE monitored_event_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_records_premium_item
  ON public.payment_records (premium_item_id);
