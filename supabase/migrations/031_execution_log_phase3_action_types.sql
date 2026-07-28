-- Phase 3: expand execution_logs action types for desk + surface diversity observability

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
    'desk_intent', 'desk_workflow', 'sponsored_watch', 'premium_receipt'
  ));
