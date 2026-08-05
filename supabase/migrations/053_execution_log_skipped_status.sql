-- Record expected no-op executions without presenting them as failures.

ALTER TABLE public.execution_logs
  DROP CONSTRAINT IF EXISTS execution_logs_status_check;

ALTER TABLE public.execution_logs
  ADD CONSTRAINT execution_logs_status_check
  CHECK (status IN ('started', 'succeeded', 'retrying', 'skipped', 'failed'));
