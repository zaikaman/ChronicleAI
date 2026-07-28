-- P1-1: SQL aggregates for public activity analytics.
-- Replaces fetching up to 4k payment/newsletter sample rows per /activity request.

-- ── Subscription + payment route aggregates ──────────────────────────────
CREATE OR REPLACE FUNCTION public.activity_subscription_analytics()
RETURNS jsonb
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  WITH entitled AS (
    SELECT
      amount_per_period,
      GREATEST(COALESCE(billing_period_days, 30), 1)::numeric AS billing_period_days,
      COALESCE(NULLIF(trim(currency), ''), 'USDC') AS currency
    FROM public.x402_newsletter_subscriptions
    WHERE status IN ('active', 'past_due')
  ),
  mrr_agg AS (
    SELECT
      COALESCE(SUM(amount_per_period * 30.0 / billing_period_days), 0)::numeric AS mrr,
      COALESCE(
        (ARRAY_AGG(currency ORDER BY amount_per_period DESC NULLS LAST))[1],
        'USDC'
      ) AS mrr_currency,
      COUNT(*)::int AS active_newsletter_subscriptions
    FROM entitled
  ),
  payment_stats AS (
    SELECT
      COUNT(*)::int AS total_payment_attempts,
      COUNT(*) FILTER (WHERE status = 'settled')::int AS settled_payments,
      COALESCE(
        SUM(
          CASE
            WHEN status = 'settled' THEN COALESCE(amount_settled, amount_requested, 0)
            ELSE 0
          END
        ),
        0
      )::numeric AS total_settled_volume,
      COUNT(*) FILTER (
        WHERE status = 'settled' AND referral_address IS NOT NULL AND trim(referral_address) <> ''
      )::int AS referred_settled_count,
      COALESCE(
        SUM(
          CASE
            WHEN status = 'settled'
              AND referral_address IS NOT NULL
              AND trim(referral_address) <> ''
            THEN COALESCE(amount_settled, amount_requested, 0)
            ELSE 0
          END
        ),
        0
      )::numeric AS referred_settled_volume
    FROM public.payment_records
  ),
  route_mix AS (
    SELECT
      COALESCE(NULLIF(trim(payment_route), ''), 'unknown') AS route,
      COUNT(*)::int AS settled_count,
      COALESCE(SUM(COALESCE(amount_settled, amount_requested, 0)), 0)::numeric AS settled_volume
    FROM public.payment_records
    WHERE status = 'settled'
    GROUP BY 1
  ),
  total_volume AS (
    SELECT COALESCE(SUM(settled_volume), 0)::numeric AS v FROM route_mix
  )
  SELECT jsonb_build_object(
    'mrr', ROUND((SELECT mrr FROM mrr_agg)::numeric, 2),
    'mrrCurrency', (SELECT mrr_currency FROM mrr_agg),
    'activeNewsletterSubscriptions', (SELECT active_newsletter_subscriptions FROM mrr_agg),
    'settledPayments', (SELECT settled_payments FROM payment_stats),
    'totalPaymentAttempts', (SELECT total_payment_attempts FROM payment_stats),
    'conversionRate', CASE
      WHEN (SELECT total_payment_attempts FROM payment_stats) > 0
      THEN ROUND(
        (SELECT settled_payments FROM payment_stats)::numeric
          / (SELECT total_payment_attempts FROM payment_stats)::numeric,
        4
      )
      ELSE 0
    END,
    'totalSettledVolume', ROUND((SELECT total_settled_volume FROM payment_stats)::numeric, 2),
    'referredSettledCount', (SELECT referred_settled_count FROM payment_stats),
    'referredSettledVolume', ROUND((SELECT referred_settled_volume FROM payment_stats)::numeric, 2),
    'routeMix', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'route', r.route,
            'settledCount', r.settled_count,
            'settledVolume', ROUND(r.settled_volume, 2),
            'volumeShare', CASE
              WHEN t.v > 0 THEN ROUND(r.settled_volume / t.v, 4)
              ELSE 0
            END
          )
          ORDER BY r.settled_volume DESC
        )
        FROM route_mix r
        CROSS JOIN total_volume t
      ),
      '[]'::jsonb
    )
  );
$$;

COMMENT ON FUNCTION public.activity_subscription_analytics() IS
  'Aggregated subscription/MRR + payment route analytics for GET /activity. Avoids shipping 2k payment rows.';

-- ── Referral partner aggregates joined with affiliate directory ──────────
CREATE OR REPLACE FUNCTION public.activity_referral_attribution()
RETURNS jsonb
LANGUAGE sql
STABLE
PARALLEL SAFE
AS $$
  WITH payment_partners AS (
    SELECT
      lower(trim(referral_address)) AS referral_address,
      COUNT(*)::int AS settled_payment_count,
      COALESCE(SUM(COALESCE(amount_settled, amount_requested, 0)), 0)::numeric AS attributed_volume,
      COALESCE(
        (ARRAY_AGG(COALESCE(NULLIF(trim(currency), ''), 'USDC') ORDER BY requested_at DESC NULLS LAST))[1],
        'USDC'
      ) AS currency
    FROM public.payment_records
    WHERE status = 'settled'
      AND referral_address IS NOT NULL
      AND trim(referral_address) <> ''
    GROUP BY 1
  ),
  newsletter_partners AS (
    SELECT
      lower(trim(referral_address)) AS referral_address,
      COUNT(*)::int AS newsletter_subscription_count,
      COALESCE(
        (ARRAY_AGG(COALESCE(NULLIF(trim(currency), ''), 'USDC') ORDER BY created_at DESC NULLS LAST))[1],
        'USDC'
      ) AS currency
    FROM public.x402_newsletter_subscriptions
    WHERE referral_address IS NOT NULL
      AND trim(referral_address) <> ''
    GROUP BY 1
  ),
  all_addresses AS (
    SELECT referral_address FROM payment_partners
    UNION
    SELECT referral_address FROM newsletter_partners
  ),
  partners AS (
    SELECT
      a.referral_address,
      aff.display_name,
      aff.referral_code,
      aff.status AS affiliate_status,
      COALESCE(p.settled_payment_count, 0)::int AS settled_payment_count,
      COALESCE(p.attributed_volume, 0)::numeric AS attributed_volume,
      COALESCE(p.currency, n.currency, 'USDC') AS currency,
      COALESCE(n.newsletter_subscription_count, 0)::int AS newsletter_subscription_count
    FROM all_addresses a
    LEFT JOIN payment_partners p ON p.referral_address = a.referral_address
    LEFT JOIN newsletter_partners n ON n.referral_address = a.referral_address
    LEFT JOIN public.affiliates aff ON lower(trim(aff.wallet_address)) = a.referral_address
  )
  SELECT jsonb_build_object(
    'partners', COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'referralAddress', referral_address,
            'displayName', display_name,
            'referralCode', referral_code,
            'affiliateStatus', affiliate_status,
            'settledPaymentCount', settled_payment_count,
            'attributedVolume', ROUND(attributed_volume, 2),
            'currency', currency,
            'newsletterSubscriptionCount', newsletter_subscription_count
          )
          ORDER BY attributed_volume DESC, settled_payment_count DESC
        )
        FROM partners
      ),
      '[]'::jsonb
    ),
    'totalReferredVolume', COALESCE(
      (SELECT ROUND(SUM(attributed_volume), 2) FROM partners),
      0
    ),
    'totalReferredPayments', COALESCE(
      (SELECT SUM(settled_payment_count)::int FROM partners),
      0
    ),
    'currency', COALESCE(
      (SELECT currency FROM partners ORDER BY attributed_volume DESC LIMIT 1),
      'USDC'
    )
  );
$$;

COMMENT ON FUNCTION public.activity_referral_attribution() IS
  'Referral partner volume/payment aggregates for GET /activity. Avoids shipping 2k payment rows + 500 affiliates.';

GRANT EXECUTE ON FUNCTION public.activity_subscription_analytics() TO service_role;
GRANT EXECUTE ON FUNCTION public.activity_referral_attribution() TO service_role;
