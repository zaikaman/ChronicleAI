-- Migration: Full sponsored watch loop (Loop 4) support
-- Date: 2026-07-28
-- @requires-db-prep
--
-- Adds on-chain watch id, source-event provenance, generated report fields,
-- and campaign monitoring counters for automated end-of-campaign publication.

ALTER TABLE public.sponsored_watches
  ADD COLUMN IF NOT EXISTS on_chain_watch_id BIGINT,
  ADD COLUMN IF NOT EXISTS source_event_ids UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS source_event_root TEXT,
  ADD COLUMN IF NOT EXISTS report_title TEXT,
  ADD COLUMN IF NOT EXISTS report_summary TEXT,
  ADD COLUMN IF NOT EXISTS report_highlights JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS report_analysis TEXT,
  ADD COLUMN IF NOT EXISTS last_monitored_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS monitored_event_count INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_sponsored_watches_on_chain_watch_id
  ON public.sponsored_watches (on_chain_watch_id)
  WHERE on_chain_watch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sponsored_watches_ends_at_status
  ON public.sponsored_watches (ends_at, status)
  WHERE status IN ('accepted', 'monitoring');
