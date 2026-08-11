-- Persistent Telegram identity for Watch campaigns.
-- Existing one-time bindings remain valid for legacy callers; new /start flows
-- use a hashed durable token and can be revoked explicitly.

ALTER TABLE public.telegram_bindings
  ADD COLUMN IF NOT EXISTS token_hash TEXT,
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS idx_telegram_bindings_token_hash
  ON public.telegram_bindings (token_hash)
  WHERE token_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_telegram_bindings_active_chat
  ON public.telegram_bindings (chat_id, created_at DESC)
  WHERE token_hash IS NOT NULL AND revoked_at IS NULL;
