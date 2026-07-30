-- Migration: Persist affiliate agent chat background jobs
-- Survives API process restarts.

CREATE TABLE IF NOT EXISTS public.affiliate_agent_jobs (
  id TEXT PRIMARY KEY,
  affiliate_wallet TEXT NOT NULL,
  status TEXT NOT NULL,
  request JSONB NOT NULL,
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_affiliate_agent_jobs_wallet ON public.affiliate_agent_jobs (affiliate_wallet);
CREATE INDEX IF NOT EXISTS idx_affiliate_agent_jobs_created_at ON public.affiliate_agent_jobs (created_at DESC);

COMMENT ON TABLE public.affiliate_agent_jobs IS
  'Persisted affiliate agent chat jobs. Source of truth across API restarts.';
