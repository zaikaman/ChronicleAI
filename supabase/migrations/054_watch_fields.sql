-- Migration: Watch product Phase 2 fields
-- Adds wallet/contract target kind, Telegram delivery target, visibility,
-- and one-time Telegram binding codes for private watch alerts.

ALTER TABLE public.sponsored_watches
  ADD COLUMN IF NOT EXISTS target_kind TEXT NOT NULL DEFAULT 'contract'
    CHECK (target_kind IN ('contract', 'wallet')),
  ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT,
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public'
    CHECK (visibility IN ('public', 'private')),
  ADD COLUMN IF NOT EXISTS last_alert_sent_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_sponsored_watches_visibility
  ON public.sponsored_watches (visibility, status);

-- Telegram bindings: links a one-time code (given by the bot on /start) to a chat_id
-- so the bot may DM that user for watch alerts. Telegram requires user-initiated contact.
CREATE TABLE IF NOT EXISTS telegram_bindings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  chat_id TEXT NOT NULL,
  username TEXT,
  wallet_address TEXT,
  source TEXT NOT NULL DEFAULT 'watch',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '30 minutes'),
  used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_telegram_bindings_code ON telegram_bindings (code);
CREATE INDEX IF NOT EXISTS idx_telegram_bindings_chat_id ON telegram_bindings (chat_id);

-- Deny-by-default for anon/authenticated; API uses service_role (bypasses RLS).
ALTER TABLE public.telegram_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.telegram_bindings FORCE ROW LEVEL SECURITY;
