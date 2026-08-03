-- Migration: Chronicle Desk data model (signals, intents, positions, capital, tickets, heartbeats)

-- ── Desk Signals ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.desk_signals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_type TEXT NOT NULL CHECK (signal_type IN (
    'health_factor',
    'apy_delta',
    'oracle_basis',
    'gas_regime',
    'liquidation_cluster',
    'capital_tick',
    'manual'
  )),
  chain_id INTEGER NOT NULL DEFAULT 11155111,
  severity INTEGER NOT NULL DEFAULT 0 CHECK (severity >= 0 AND severity <= 100),
  features JSONB NOT NULL DEFAULT '{}'::jsonb,
  sources JSONB NOT NULL DEFAULT '{}'::jsonb,
  policy_verdict TEXT NOT NULL DEFAULT 'ignore' CHECK (policy_verdict IN (
    'trade', 'defend', 'defer', 'ignore'
  )),
  dedupe_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_desk_signals_dedupe_key
  ON public.desk_signals (dedupe_key);

CREATE INDEX IF NOT EXISTS idx_desk_signals_created_at
  ON public.desk_signals (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_desk_signals_type_created
  ON public.desk_signals (signal_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_desk_signals_verdict
  ON public.desk_signals (policy_verdict)
  WHERE policy_verdict IN ('trade', 'defend');

-- ── Desk Intents ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.desk_intents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id UUID REFERENCES public.desk_signals(id) ON DELETE SET NULL,
  strategy TEXT NOT NULL CHECK (strategy IN (
    'risk_defend', 'yield_rotation', 'oracle_amm'
  )),
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN (
    'proposed', 'approved', 'executing', 'filled', 'failed', 'deferred', 'cancelled'
  )),
  notional_usdc DOUBLE PRECISION NOT NULL DEFAULT 0,
  legs JSONB NOT NULL DEFAULT '[]'::jsonb,
  reason_codes TEXT[] NOT NULL DEFAULT '{}',
  policy_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  keeper_hub_run_id TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_desk_intents_created_at
  ON public.desk_intents (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_desk_intents_status
  ON public.desk_intents (status);

CREATE INDEX IF NOT EXISTS idx_desk_intents_strategy_status
  ON public.desk_intents (strategy, status);

CREATE INDEX IF NOT EXISTS idx_desk_intents_signal_id
  ON public.desk_intents (signal_id)
  WHERE signal_id IS NOT NULL;

-- At most one in-flight intent per strategy (single-flight).
CREATE UNIQUE INDEX IF NOT EXISTS idx_desk_intents_open_strategy
  ON public.desk_intents (strategy)
  WHERE status IN ('proposed', 'approved', 'executing');

-- ── Desk Positions (snapshots) ──────────────────────────
CREATE TABLE IF NOT EXISTS public.desk_positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  as_of TIMESTAMPTZ NOT NULL,
  desk_address TEXT NOT NULL,
  usdc DOUBLE PRECISION NOT NULL DEFAULT 0,
  weth DOUBLE PRECISION NOT NULL DEFAULT 0,
  link DOUBLE PRECISION NOT NULL DEFAULT 0,
  aave JSONB NOT NULL DEFAULT '{}'::jsonb,
  morpho JSONB,
  lido JSONB,
  equity_usdc DOUBLE PRECISION NOT NULL DEFAULT 0,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_desk_positions_as_of
  ON public.desk_positions (as_of DESC);

CREATE INDEX IF NOT EXISTS idx_desk_positions_desk_address_as_of
  ON public.desk_positions (desk_address, as_of DESC);

-- ── Desk Capital Moves ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.desk_capital_moves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  direction TEXT NOT NULL CHECK (direction IN (
    'topup', 'sweep', 'emergency_return'
  )),
  amount_usdc DOUBLE PRECISION NOT NULL,
  from_address TEXT NOT NULL,
  to_address TEXT NOT NULL,
  tx_hash TEXT,
  explorer_url TEXT,
  reason TEXT,
  treasury_usdc_after DOUBLE PRECISION,
  desk_equity_after DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_desk_capital_moves_created_at
  ON public.desk_capital_moves (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_desk_capital_moves_direction
  ON public.desk_capital_moves (direction, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_desk_capital_moves_tx_hash
  ON public.desk_capital_moves (tx_hash)
  WHERE tx_hash IS NOT NULL;

-- ── Desk Tickets (proof-of-trade) ────────────────────────
CREATE TABLE IF NOT EXISTS public.desk_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_id UUID NOT NULL REFERENCES public.desk_intents(id) ON DELETE CASCADE,
  ticket_hash TEXT NOT NULL,
  signal_hash TEXT,
  intent_hash TEXT,
  content_uri TEXT,
  tx_hash TEXT,
  keeper_hub_run_id TEXT,
  explorer_url TEXT,
  summary TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_desk_tickets_ticket_hash
  ON public.desk_tickets (ticket_hash);

CREATE INDEX IF NOT EXISTS idx_desk_tickets_intent_id
  ON public.desk_tickets (intent_id);

CREATE INDEX IF NOT EXISTS idx_desk_tickets_created_at
  ON public.desk_tickets (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_desk_tickets_tx_hash
  ON public.desk_tickets (tx_hash)
  WHERE tx_hash IS NOT NULL;

-- ── Desk Heartbeats ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.desk_heartbeats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL CHECK (source IN ('api', 'scheduler', 'workflow')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_desk_heartbeats_created_at
  ON public.desk_heartbeats (created_at DESC);
