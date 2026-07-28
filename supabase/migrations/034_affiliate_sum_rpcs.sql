-- P0-8: Server-side SUM aggregates for affiliate balances.
-- Replaces client-side fetch + reduce with limit(10_000), which under-counts past 10k rows.

CREATE OR REPLACE FUNCTION public.sum_affiliate_earned(p_affiliate_wallet text)
RETURNS numeric
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT COALESCE(SUM(ae.reward_amount), 0)::numeric
  FROM public.affiliate_earnings ae
  WHERE ae.affiliate_wallet = lower(trim(p_affiliate_wallet));
$$;

COMMENT ON FUNCTION public.sum_affiliate_earned(text) IS
  'All-time SUM(reward_amount) for an affiliate wallet. Used by affiliate dashboard balance.';

CREATE OR REPLACE FUNCTION public.sum_affiliate_withdrawals(
  p_affiliate_wallet text,
  p_statuses text[]
)
RETURNS numeric
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  SELECT COALESCE(SUM(aw.amount), 0)::numeric
  FROM public.affiliate_withdrawals aw
  WHERE aw.affiliate_wallet = lower(trim(p_affiliate_wallet))
    AND aw.status = ANY (p_statuses);
$$;

COMMENT ON FUNCTION public.sum_affiliate_withdrawals(text, text[]) IS
  'SUM(amount) of affiliate_withdrawals for a wallet filtered by status list (reserved/paid or completed-only).';

GRANT EXECUTE ON FUNCTION public.sum_affiliate_earned(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.sum_affiliate_withdrawals(text, text[]) TO service_role;
