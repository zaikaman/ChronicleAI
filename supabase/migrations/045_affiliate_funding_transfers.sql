-- Affiliate funding float: reserve each affiliate reward once, then move the
-- exact credited amount from the treasury to the KeeperHub execution wallet.

CREATE TABLE IF NOT EXISTS public.affiliate_funding_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_earning_id UUID NOT NULL,
  amount NUMERIC NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'USDC',
  destination_wallet TEXT NOT NULL,
  chain_id INTEGER NOT NULL CHECK (chain_id > 0),
  token_address TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'processing', 'completed', 'failed'
  )),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  tx_hash TEXT,
  explorer_url TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  CONSTRAINT affiliate_funding_transfers_earning_unique
    UNIQUE (affiliate_earning_id),
  CONSTRAINT affiliate_funding_transfers_earning_fkey
    FOREIGN KEY (affiliate_earning_id)
    REFERENCES public.affiliate_earnings(id)
    ON DELETE RESTRICT,
  CONSTRAINT affiliate_funding_transfers_wallet_format
    CHECK (destination_wallet ~* '^0x[a-fA-F0-9]{40}$'),
  CONSTRAINT affiliate_funding_transfers_token_format
    CHECK (token_address ~* '^0x[a-fA-F0-9]{40}$')
);

CREATE INDEX IF NOT EXISTS idx_affiliate_funding_transfers_status
  ON public.affiliate_funding_transfers (status, updated_at);

COMMENT ON TABLE public.affiliate_funding_transfers IS
  'Idempotent treasury funding records for the KeeperHub affiliate payout float.';

ALTER TABLE public.affiliate_funding_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_funding_transfers FORCE ROW LEVEL SECURITY;

