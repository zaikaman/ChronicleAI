-- Chronicle Pass wallet-authenticated sessions + challenge nonces.
--
-- v1 stores BOTH single-use auth nonces (challenge_issued) and active session
-- tokens (active) in one table. A nonce is single-use: it is consumed when the
-- session activates (status flips to 'active' and session_token_hash is set).
-- Replays of the same nonce are rejected by the UNIQUE(nonce) constraint plus
-- the status check in the repository.
--
-- Session tokens are NEVER stored in plaintext — only their SHA-256 hash.

CREATE TABLE IF NOT EXISTS public.chronicle_pass_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address TEXT NOT NULL,
  nonce TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'challenge_issued'
    CHECK (status IN ('challenge_issued', 'active', 'expired', 'revoked')),
  message TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  session_token_hash TEXT UNIQUE,
  session_expires_at TIMESTAMPTZ,
  user_agent TEXT,
  ip_address TEXT,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chronicle_pass_sessions_nonce_unique UNIQUE (nonce),
  CONSTRAINT chronicle_pass_sessions_wallet_not_blank CHECK (length(btrim(wallet_address)) > 0),
  CONSTRAINT chronicle_pass_sessions_nonce_not_blank CHECK (length(btrim(nonce)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_chronicle_pass_sessions_wallet
  ON public.chronicle_pass_sessions (wallet_address);

CREATE INDEX IF NOT EXISTS idx_chronicle_pass_sessions_session_hash
  ON public.chronicle_pass_sessions (session_token_hash)
  WHERE session_token_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_chronicle_pass_sessions_expiry
  ON public.chronicle_pass_sessions (expires_at);

-- Service-role only; the API authenticates via cookie + wallet signature.
ALTER TABLE public.chronicle_pass_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chronicle_pass_sessions FORCE ROW LEVEL SECURITY;

COMMENT ON TABLE public.chronicle_pass_sessions IS
  'Chronicle Pass wallet auth: single-use challenge nonces and active HttpOnly session token hashes.';
