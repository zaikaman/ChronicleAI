-- Bound payment challenge retention and keep treasury totals in the database.

CREATE INDEX IF NOT EXISTS idx_payment_records_challenge_cleanup
  ON public.payment_records (status, expires_at)
  WHERE status IN ('challenge_issued', 'pending', 'expired');

CREATE OR REPLACE FUNCTION public.treasury_payment_aggregates()
RETURNS jsonb
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT jsonb_build_object(
    'totalRevenue', COALESCE(SUM(amount_settled), 0),
    'totalPaidRequests', COUNT(*)
  )
  FROM public.payment_records
  WHERE status = 'settled';
$$;

COMMENT ON FUNCTION public.treasury_payment_aggregates() IS
  'Database-side settled payment count and revenue aggregate for treasury metrics.';

GRANT EXECUTE ON FUNCTION public.treasury_payment_aggregates() TO service_role;
