-- Affiliate referral identifier on payment challenges / settlements.
-- Distinct from payer_reference: the subscriber who pays is not the referral partner.
-- Revenue routing attributes capped rewards only to approved referral wallets.

ALTER TABLE public.payment_records
  ADD COLUMN IF NOT EXISTS referral_address TEXT;

COMMENT ON COLUMN public.payment_records.referral_address IS
  'Optional approved affiliate wallet from x402/MPP intent metadata (not the payer).';

CREATE INDEX IF NOT EXISTS idx_payment_records_referral_settled
  ON public.payment_records (referral_address)
  WHERE status = 'settled' AND referral_address IS NOT NULL;
