-- Referral tracking: wallet-connect attribution, affiliate earnings ledger, agent withdrawals.
-- First-touch attribution: a referred wallet maps to exactly one affiliate.
-- Earnings credit on payment settlement; withdrawals are agent-initiated via KeeperHub (not auto-routed).

-- ── Who referred whom (sticky first-touch on wallet connect) ───────────────
CREATE TABLE IF NOT EXISTS public.referral_attributions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Referred visitor wallet (unique — first touch wins).
  referred_wallet TEXT NOT NULL,
  -- Affiliate payout wallet (must match an approved affiliates.wallet_address).
  affiliate_wallet TEXT NOT NULL,
  -- Optional referral code used at attribution time.
  referral_code TEXT,
  -- How the link was created: web_connect | payment_intent | manual
  source TEXT NOT NULL DEFAULT 'web_connect' CHECK (source IN (
    'web_connect', 'payment_intent', 'manual'
  )),
  attributed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT referral_attributions_referred_wallet_format
    CHECK (referred_wallet ~* '^0x[a-fA-F0-9]{40}$'),
  CONSTRAINT referral_attributions_affiliate_wallet_format
    CHECK (affiliate_wallet ~* '^0x[a-fA-F0-9]{40}$'),
  CONSTRAINT referral_attributions_referred_wallet_unique UNIQUE (referred_wallet),
  CONSTRAINT referral_attributions_no_self_referral
    CHECK (lower(referred_wallet) <> lower(affiliate_wallet))
);

CREATE INDEX IF NOT EXISTS idx_referral_attributions_affiliate
  ON public.referral_attributions (affiliate_wallet);

CREATE INDEX IF NOT EXISTS idx_referral_attributions_referred
  ON public.referral_attributions (referred_wallet);

COMMENT ON TABLE public.referral_attributions IS
  'First-touch referral links: when a visitor connects a wallet after arriving with ?ref=, they are attributed to that affiliate.';

-- ── Affiliate earnings (credit on settled referred payments) ───────────────
CREATE TABLE IF NOT EXISTS public.affiliate_earnings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_wallet TEXT NOT NULL,
  referred_wallet TEXT NOT NULL,
  payment_record_id UUID NOT NULL,
  -- Gross settled payment amount (same currency units as payment_records).
  payment_amount NUMERIC NOT NULL CHECK (payment_amount >= 0),
  -- Share applied (e.g. 0.2 = 20%).
  reward_share NUMERIC NOT NULL CHECK (reward_share >= 0 AND reward_share <= 1),
  -- Net USDC credited to the affiliate for this payment.
  reward_amount NUMERIC NOT NULL CHECK (reward_amount >= 0),
  currency TEXT NOT NULL DEFAULT 'USDC',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT affiliate_earnings_affiliate_wallet_format
    CHECK (affiliate_wallet ~* '^0x[a-fA-F0-9]{40}$'),
  CONSTRAINT affiliate_earnings_referred_wallet_format
    CHECK (referred_wallet ~* '^0x[a-fA-F0-9]{40}$'),
  CONSTRAINT affiliate_earnings_payment_unique UNIQUE (payment_record_id)
);

CREATE INDEX IF NOT EXISTS idx_affiliate_earnings_affiliate
  ON public.affiliate_earnings (affiliate_wallet);

CREATE INDEX IF NOT EXISTS idx_affiliate_earnings_created
  ON public.affiliate_earnings (created_at DESC);

COMMENT ON TABLE public.affiliate_earnings IS
  'Immutable credits: when a referred wallet settles a payment, the affiliate earns a capped share in USDC.';

-- ── Affiliate withdrawals (agent-initiated, KeeperHub-executed) ────────────
CREATE TABLE IF NOT EXISTS public.affiliate_withdrawals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  affiliate_wallet TEXT NOT NULL,
  amount NUMERIC NOT NULL CHECK (amount > 0),
  currency TEXT NOT NULL DEFAULT 'USDC',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'processing', 'completed', 'failed', 'cancelled'
  )),
  -- Agent chat turn that requested this withdrawal (audit).
  agent_message TEXT,
  payout_record_id UUID,
  payout_tx_hash TEXT,
  registry_tx_hash TEXT,
  keeper_hub_run_id TEXT,
  explorer_url TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT affiliate_withdrawals_affiliate_wallet_format
    CHECK (affiliate_wallet ~* '^0x[a-fA-F0-9]{40}$')
);

CREATE INDEX IF NOT EXISTS idx_affiliate_withdrawals_affiliate
  ON public.affiliate_withdrawals (affiliate_wallet);

CREATE INDEX IF NOT EXISTS idx_affiliate_withdrawals_status
  ON public.affiliate_withdrawals (status);

COMMENT ON TABLE public.affiliate_withdrawals IS
  'Affiliate-requested USDC withdrawals. Executed on-chain via the affiliate agent (KeeperHub), not the scheduled revenue router.';
