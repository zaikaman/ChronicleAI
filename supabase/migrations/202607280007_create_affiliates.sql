-- Approved referral partners (affiliates).
-- Website/API registration is the source of truth for who may receive referral rewards.
-- Revenue routing attributes capped shares only to status = 'approved' wallets.

CREATE TABLE IF NOT EXISTS public.affiliates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Normalized lowercase EVM payout wallet (unique).
  wallet_address TEXT NOT NULL,
  -- Optional human label shown on the site / dashboard.
  display_name TEXT,
  -- Optional short code for referral links (?ref=code). Unique when set.
  referral_code TEXT,
  -- approved = eligible for referral payouts; pending = applied; suspended = blocked.
  status TEXT NOT NULL DEFAULT 'approved' CHECK (status IN (
    'pending', 'approved', 'suspended'
  )),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT affiliates_wallet_address_format
    CHECK (wallet_address ~* '^0x[a-fA-F0-9]{40}$'),
  CONSTRAINT affiliates_wallet_address_unique UNIQUE (wallet_address),
  CONSTRAINT affiliates_referral_code_unique UNIQUE (referral_code)
);

CREATE INDEX IF NOT EXISTS idx_affiliates_status
  ON public.affiliates (status);

CREATE INDEX IF NOT EXISTS idx_affiliates_wallet_address
  ON public.affiliates (wallet_address);

CREATE INDEX IF NOT EXISTS idx_affiliates_referral_code
  ON public.affiliates (referral_code)
  WHERE referral_code IS NOT NULL;

COMMENT ON TABLE public.affiliates IS
  'Referral partners registered via the product; only approved wallets receive revenue-routing affiliate payouts.';
