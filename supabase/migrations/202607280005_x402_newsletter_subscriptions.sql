-- Recurring x402 monthly newsletter subscriptions
-- Date: 2026-07-28
--
-- IDEA revenue vector: monthly newsletter via recurring x402 agreements.
-- Stores subscription intent, billing periods, renewal state, and payment linkage.

-- Allow monthly_newsletter as a premium catalog product type (used for payment_records FK).
ALTER TABLE public.premium_intelligence_items
  DROP CONSTRAINT IF EXISTS premium_intelligence_items_content_type_check;

ALTER TABLE public.premium_intelligence_items
  ADD CONSTRAINT premium_intelligence_items_content_type_check
  CHECK (content_type IN (
    'deep_dive',
    'historical_feed',
    'structured_feed',
    'sponsored_monitor',
    'monthly_newsletter'
  ));

CREATE TABLE IF NOT EXISTS public.x402_newsletter_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  email_normalized TEXT NOT NULL,
  payer_wallet TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'past_due', 'cancelled', 'expired')),
  amount_per_period DOUBLE PRECISION NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USDC',
  billing_period_days INTEGER NOT NULL DEFAULT 30
    CHECK (billing_period_days > 0 AND billing_period_days <= 366),
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  next_renewal_at TIMESTAMPTZ,
  periods_paid INTEGER NOT NULL DEFAULT 0
    CHECK (periods_paid >= 0),
  grace_period_days INTEGER NOT NULL DEFAULT 3
    CHECK (grace_period_days >= 0 AND grace_period_days <= 30),
  referral_address TEXT,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT FALSE,
  cancelled_at TIMESTAMPTZ,
  premium_item_id UUID REFERENCES public.premium_intelligence_items(id) ON DELETE SET NULL,
  email_subscriber_id UUID REFERENCES public.email_subscribers(id) ON DELETE SET NULL,
  last_payment_record_id UUID REFERENCES public.payment_records(id) ON DELETE SET NULL,
  last_settlement_reference TEXT,
  last_settled_at TIMESTAMPTZ,
  pending_challenge_reference TEXT,
  pending_payment_record_id UUID REFERENCES public.payment_records(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT x402_newsletter_subscriptions_email_normalized_unique UNIQUE (email_normalized)
);

CREATE INDEX IF NOT EXISTS idx_x402_newsletter_subs_status_period
  ON public.x402_newsletter_subscriptions (status, current_period_end);

CREATE INDEX IF NOT EXISTS idx_x402_newsletter_subs_next_renewal
  ON public.x402_newsletter_subscriptions (next_renewal_at)
  WHERE status IN ('active', 'past_due');

CREATE INDEX IF NOT EXISTS idx_x402_newsletter_subs_payer
  ON public.x402_newsletter_subscriptions (payer_wallet)
  WHERE payer_wallet IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_x402_newsletter_subs_pending_challenge
  ON public.x402_newsletter_subscriptions (pending_challenge_reference)
  WHERE pending_challenge_reference IS NOT NULL;

COMMENT ON TABLE public.x402_newsletter_subscriptions IS
  'Recurring x402 monthly newsletter agreements: billing periods, renewals, and paid entitlement.';
