-- Migration: Add LLM generation attempts table
-- @requires-db-prep

-- ── LLM Generation Attempts ────────────────────────────
CREATE TABLE IF NOT EXISTS public.llm_generation_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL DEFAULT 'public_alert' CHECK (entity_type IN ('public_alert', 'daily_digest')),
  entity_id UUID REFERENCES public.public_alerts(id) ON DELETE SET NULL,
  monitored_event_id UUID NOT NULL REFERENCES public.monitored_events(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('gemini', 'openai', 'groq')),
  attempt_order INTEGER NOT NULL CHECK (attempt_order BETWEEN 1 AND 3),
  status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed', 'invalid_response')),
  latency_ms INTEGER NOT NULL DEFAULT 0,
  failure_reason TEXT,
  response_metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Indexes ────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_llm_attempts_monitored_event
  ON public.llm_generation_attempts (monitored_event_id);

CREATE INDEX IF NOT EXISTS idx_llm_attempts_entity
  ON public.llm_generation_attempts (entity_type, entity_id)
  WHERE entity_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_llm_attempts_created_at
  ON public.llm_generation_attempts (created_at DESC);

-- ── Add generation fields to public_alerts ─────────────
ALTER TABLE public.public_alerts
  ADD COLUMN IF NOT EXISTS generation_provider TEXT CHECK (generation_provider IN ('gemini', 'openai', 'groq')),
  ADD COLUMN IF NOT EXISTS generation_attempt_ids UUID[] NOT NULL DEFAULT '{}';
