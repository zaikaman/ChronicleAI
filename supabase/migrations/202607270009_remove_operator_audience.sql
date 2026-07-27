-- Remove operator-only audience and rename operator_notification → notification.
-- All product surfaces are public for the hackathon.

-- ── Audience: drop operator from public_alerts / daily_digests ──
UPDATE public.public_alerts
SET audience = 'public'
WHERE audience = 'operator';

UPDATE public.daily_digests
SET audience = 'public'
WHERE audience = 'operator';

ALTER TABLE public.public_alerts
  DROP CONSTRAINT IF EXISTS public_alerts_audience_check;

ALTER TABLE public.public_alerts
  ADD CONSTRAINT public_alerts_audience_check
  CHECK (audience IN ('public', 'premium'));

ALTER TABLE public.daily_digests
  DROP CONSTRAINT IF EXISTS daily_digests_audience_check;

ALTER TABLE public.daily_digests
  ADD CONSTRAINT daily_digests_audience_check
  CHECK (audience IN ('public', 'premium'));

-- ── Execution logs: rename action type ──
UPDATE public.execution_logs
SET action_type = 'notification'
WHERE action_type = 'operator_notification';

ALTER TABLE public.execution_logs
  DROP CONSTRAINT IF EXISTS execution_logs_action_type_check;

ALTER TABLE public.execution_logs
  ADD CONSTRAINT execution_logs_action_type_check
  CHECK (action_type IN (
    'monitor', 'generate_alert', 'publish_alert',
    'generate_digest', 'publish_digest',
    'payment', 'treasury_check', 'notification',
    'registry_write', 'payout'
  ));
