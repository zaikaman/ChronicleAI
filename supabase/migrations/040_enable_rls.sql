-- P3-8: Enable Row Level Security before any browser Supabase (anon) usage.
--
-- The API uses the service_role key, which bypasses RLS. Browser/anon clients
-- must only see intentionally public rows. Private operational tables get RLS
-- with no policies (deny-by-default for anon/authenticated).

-- ── Public-readable product tables ───────────────────────────────────────────

ALTER TABLE public.public_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.public_alerts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS public_alerts_select_published ON public.public_alerts;
CREATE POLICY public_alerts_select_published
  ON public.public_alerts
  FOR SELECT
  TO anon, authenticated
  USING (
    audience = 'public'
    AND delivery_status = 'published'
  );

ALTER TABLE public.daily_digests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.daily_digests FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS daily_digests_select_published ON public.daily_digests;
CREATE POLICY daily_digests_select_published
  ON public.daily_digests
  FOR SELECT
  TO anon, authenticated
  USING (
    audience = 'public'
    AND publication_status = 'published'
  );

ALTER TABLE public.premium_intelligence_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.premium_intelligence_items FORCE ROW LEVEL SECURITY;

-- Anon may list available teasers only (summary_public is the public teaser;
-- content_private remains protected by column privileges + app layer).
DROP POLICY IF EXISTS premium_items_select_available ON public.premium_intelligence_items;
CREATE POLICY premium_items_select_available
  ON public.premium_intelligence_items
  FOR SELECT
  TO anon, authenticated
  USING (status = 'available');

ALTER TABLE public.execution_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.execution_logs FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS execution_logs_select_public ON public.execution_logs;
CREATE POLICY execution_logs_select_public
  ON public.execution_logs
  FOR SELECT
  TO anon, authenticated
  USING (true);

ALTER TABLE public.treasury_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.treasury_snapshots FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS treasury_snapshots_select_public ON public.treasury_snapshots;
CREATE POLICY treasury_snapshots_select_public
  ON public.treasury_snapshots
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- ── Deny-by-default operational / private tables ─────────────────────────────
-- RLS enabled, no policies for anon/authenticated ⇒ no access.
-- service_role continues to bypass RLS for the Express API.

ALTER TABLE public.monitored_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monitored_events FORCE ROW LEVEL SECURITY;

ALTER TABLE public.payment_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_records FORCE ROW LEVEL SECURITY;

ALTER TABLE public.llm_generation_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.llm_generation_attempts FORCE ROW LEVEL SECURITY;

ALTER TABLE public.sponsored_watches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sponsored_watches FORCE ROW LEVEL SECURITY;

ALTER TABLE public.payout_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payout_records FORCE ROW LEVEL SECURITY;

ALTER TABLE public.email_subscribers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_subscribers FORCE ROW LEVEL SECURITY;

ALTER TABLE public.x402_newsletter_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.x402_newsletter_subscriptions FORCE ROW LEVEL SECURITY;

ALTER TABLE public.affiliates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliates FORCE ROW LEVEL SECURITY;

ALTER TABLE public.referral_attributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.referral_attributions FORCE ROW LEVEL SECURITY;

ALTER TABLE public.affiliate_earnings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_earnings FORCE ROW LEVEL SECURITY;

ALTER TABLE public.affiliate_withdrawals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_withdrawals FORCE ROW LEVEL SECURITY;

ALTER TABLE public.desk_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.desk_signals FORCE ROW LEVEL SECURITY;

ALTER TABLE public.desk_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.desk_intents FORCE ROW LEVEL SECURITY;

ALTER TABLE public.desk_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.desk_positions FORCE ROW LEVEL SECURITY;

ALTER TABLE public.desk_capital_moves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.desk_capital_moves FORCE ROW LEVEL SECURITY;

ALTER TABLE public.desk_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.desk_tickets FORCE ROW LEVEL SECURITY;

ALTER TABLE public.desk_heartbeats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.desk_heartbeats FORCE ROW LEVEL SECURITY;

ALTER TABLE public.desk_agent_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.desk_agent_runs FORCE ROW LEVEL SECURITY;

ALTER TABLE public.desk_control_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.desk_control_state FORCE ROW LEVEL SECURITY;

ALTER TABLE public.cctp_rebalance_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cctp_rebalance_transfers FORCE ROW LEVEL SECURITY;
