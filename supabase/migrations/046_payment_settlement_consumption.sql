-- Prevent one settlement proof from being consumed by multiple payment records.
-- NULL values remain allowed for open challenges.
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_records_settlement_reference_unique
  ON public.payment_records (settlement_reference)
  WHERE settlement_reference IS NOT NULL;

COMMENT ON INDEX public.idx_payment_records_settlement_reference_unique IS
  'Each authenticated settlement reference can be consumed by exactly one payment record.';
