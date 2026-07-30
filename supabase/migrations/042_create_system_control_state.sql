-- Migration: Persist system control-plane runtime state (e.g. Groq key rotation index)
-- Survives API process restarts; singleton row id = 'default'.

CREATE TABLE IF NOT EXISTS public.system_control_state (
  id TEXT PRIMARY KEY DEFAULT 'default',
  groq_key_index INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT system_control_state_singleton CHECK (id = 'default')
);

INSERT INTO public.system_control_state (id, groq_key_index)
VALUES ('default', 0)
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE public.system_control_state IS
  'Singleton system control state (Groq key rotation index, etc.). Source of truth across API restarts.';
