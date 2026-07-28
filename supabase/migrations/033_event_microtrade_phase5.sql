-- Phase 5: event-linked microtrade cooldown + execution log action type

ALTER TABLE public.desk_control_state
  ADD COLUMN IF NOT EXISTS last_event_microtrade_at TIMESTAMPTZ;

COMMENT ON COLUMN public.desk_control_state.last_event_microtrade_at IS
  'Last successful (or attempted-with-intent) event-linked microtrade timestamp for cooldown.';

ALTER TABLE public.execution_logs
  DROP CONSTRAINT IF EXISTS execution_logs_action_type_check;

ALTER TABLE public.execution_logs
  ADD CONSTRAINT execution_logs_action_type_check
  CHECK (action_type IN (
    'monitor', 'generate_alert', 'publish_alert',
    'generate_digest', 'publish_digest',
    'payment', 'treasury_check', 'notification',
    'registry_write', 'payout', 'treasury_audit',
    'cctp_rebalance', 'desk_agent',
    'desk_intent', 'desk_workflow', 'sponsored_watch', 'premium_receipt',
    'desk_event_microtrade'
  ));
