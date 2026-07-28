-- Migration: Index settled payment lookups by payer
-- Supports findSettledByPayer(premium_item_id, payer_reference) for access gating.

CREATE INDEX IF NOT EXISTS idx_payment_records_premium_payer_settled
  ON public.payment_records (premium_item_id, payer_reference)
  WHERE status = 'settled' AND payer_reference IS NOT NULL;
