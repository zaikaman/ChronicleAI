-- Security hardening for databases that already applied the earlier migrations.
-- Private operational tables intentionally have no anon/authenticated policies;
-- service_role access used by the API continues to bypass RLS.

ALTER TABLE public.execution_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.execution_logs FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS execution_logs_select_public ON public.execution_logs;

ALTER TABLE public.treasury_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.treasury_snapshots FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS treasury_snapshots_select_public ON public.treasury_snapshots;

ALTER TABLE public.affiliate_agent_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_agent_jobs FORCE ROW LEVEL SECURITY;

ALTER TABLE public.system_control_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_control_state FORCE ROW LEVEL SECURITY;

ALTER TABLE public.affiliate_withdrawal_nonces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.affiliate_withdrawal_nonces FORCE ROW LEVEL SECURITY;
