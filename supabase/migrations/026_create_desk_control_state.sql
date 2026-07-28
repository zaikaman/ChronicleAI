-- Migration: Persist desk control-plane runtime state (kill switch + pause)
-- Survives API process restarts; singleton row id = 'default'.

CREATE TABLE IF NOT EXISTS public.desk_control_state (
  id TEXT PRIMARY KEY DEFAULT 'default',
  kill_armed BOOLEAN NOT NULL DEFAULT false,
  kill_armed_at TIMESTAMPTZ,
  kill_armed_reason TEXT,
  last_trip_at TIMESTAMPTZ,
  last_trip_reason TEXT,
  last_keeper_hub_run_id TEXT,
  last_tx_hash TEXT,
  desk_paused BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT desk_control_state_singleton CHECK (id = 'default')
);

INSERT INTO public.desk_control_state (id)
VALUES ('default')
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE public.desk_control_state IS
  'Singleton desk control-plane state (kill switch + pause). Source of truth across API restarts.';
