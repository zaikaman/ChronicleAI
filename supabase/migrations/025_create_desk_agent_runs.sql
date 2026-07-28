-- Migration: desk_agent_runs — LLM trading agent audit trail
-- Plan: docs/DESK-LLM-AGENT-PLAN.md §7.4

CREATE TABLE IF NOT EXISTS public.desk_agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  model TEXT,
  latency_ms INTEGER,
  proposal JSONB NOT NULL DEFAULT '{}'::jsonb,
  context_digest JSONB NOT NULL DEFAULT '{}'::jsonb,
  intent_id UUID REFERENCES public.desk_intents(id) ON DELETE SET NULL,
  error_message TEXT
);

CREATE INDEX IF NOT EXISTS idx_desk_agent_runs_created_at
  ON public.desk_agent_runs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_desk_agent_runs_intent_id
  ON public.desk_agent_runs (intent_id)
  WHERE intent_id IS NOT NULL;
