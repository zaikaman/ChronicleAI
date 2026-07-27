-- Migration: Create ChronicleAI core tables
-- Date: 2026-07-27

-- ── Monitored Events ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.monitored_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,
  source_event_id TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'large_swap', 'liquidation', 'gas_spike', 'volume_anomaly', 'contract_deployment'
  )),
  chain_id BIGINT NOT NULL,
  protocol TEXT,
  asset_symbols TEXT[],
  magnitude JSONB,
  transaction_hash TEXT,
  observed_at TIMESTAMPTZ,
  captured_at TIMESTAMPTZ NOT NULL,
  significance_score DOUBLE PRECISION,
  raw_payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN (
    'received', 'qualified', 'ignored', 'failed'
  )),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Public Alerts ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.public_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  monitored_event_id UUID REFERENCES public.monitored_events(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  source_references JSONB NOT NULL DEFAULT '[]'::jsonb,
  audience TEXT NOT NULL DEFAULT 'public' CHECK (audience IN ('public', 'premium')),
  destinations JSONB,
  delivery_status TEXT NOT NULL DEFAULT 'draft' CHECK (delivery_status IN (
    'draft', 'queued', 'published', 'partial_failure', 'failed'
  )),
  published_at TIMESTAMPTZ,
  dedupe_key TEXT,
  confidence TEXT CHECK (confidence IN ('high', 'medium', 'low')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Daily Digests ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.daily_digests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_date DATE NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  highlights JSONB NOT NULL DEFAULT '[]'::jsonb,
  analysis TEXT,
  source_event_ids UUID[] NOT NULL DEFAULT '{}',
  audience TEXT NOT NULL DEFAULT 'public' CHECK (audience IN ('public', 'premium')),
  publication_status TEXT NOT NULL DEFAULT 'draft' CHECK (publication_status IN (
    'draft', 'queued', 'published', 'partial_failure', 'failed'
  )),
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Premium Intelligence Items ─────────────────────────
CREATE TABLE IF NOT EXISTS public.premium_intelligence_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  content_type TEXT NOT NULL CHECK (content_type IN (
    'deep_dive', 'historical_feed', 'structured_feed', 'sponsored_monitor'
  )),
  summary_public TEXT NOT NULL,
  content_private JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_event_ids UUID[] NOT NULL DEFAULT '{}',
  price_amount DOUBLE PRECISION NOT NULL,
  price_currency TEXT NOT NULL DEFAULT 'USD',
  payment_routes TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN (
    'draft', 'available', 'archived'
  )),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Payment Records ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payment_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  premium_item_id UUID NOT NULL REFERENCES public.premium_intelligence_items(id) ON DELETE CASCADE,
  payment_route TEXT NOT NULL CHECK (payment_route IN ('x402', 'mpp')),
  payer_reference TEXT,
  amount_requested DOUBLE PRECISION,
  amount_settled DOUBLE PRECISION,
  currency TEXT,
  status TEXT NOT NULL DEFAULT 'challenge_issued' CHECK (status IN (
    'challenge_issued', 'pending', 'settled', 'underpaid', 'expired', 'failed'
  )),
  challenge_reference TEXT,
  settlement_reference TEXT,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Treasury Snapshots ─────────────────────────────────
CREATE TABLE IF NOT EXISTS public.treasury_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  available_balance DOUBLE PRECISION NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  safety_buffer DOUBLE PRECISION NOT NULL,
  revenue_total DOUBLE PRECISION,
  estimated_generation_cost DOUBLE PRECISION,
  estimated_transaction_cost DOUBLE PRECISION,
  paid_request_count INTEGER,
  status TEXT NOT NULL DEFAULT 'healthy' CHECK (status IN (
    'healthy', 'warning', 'critical'
  )),
  captured_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Execution Logs ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.execution_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action_type TEXT NOT NULL CHECK (action_type IN (
    'monitor', 'generate_alert', 'publish_alert',
    'generate_digest', 'publish_digest',
    'payment', 'treasury_check', 'notification'
  )),
  entity_type TEXT,
  entity_id UUID,
  status TEXT NOT NULL CHECK (status IN (
    'started', 'succeeded', 'retrying', 'failed'
  )),
  message TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
