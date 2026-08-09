-- ── Remove Failed and Proposed Desk Proposals ─────────────────────────────
-- Remove failed and pending proposed desk intents and associated agent runs from the database.

DELETE FROM public.desk_agent_runs
WHERE intent_id IN (
  SELECT id FROM public.desk_intents WHERE status IN ('failed', 'proposed') OR error_message IS NOT NULL
) OR error_message IS NOT NULL;

DELETE FROM public.desk_intents
WHERE status IN ('failed', 'proposed')
   OR error_message IS NOT NULL;

DELETE FROM public.public_alerts
WHERE alert_kind = 'desk_trigger'
  AND (action_status IN ('pending', 'submitted') OR action_transaction_hash IS NULL);

