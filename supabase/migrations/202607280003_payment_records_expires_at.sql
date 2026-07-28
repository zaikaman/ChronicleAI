-- Persist challenge expiry so settlements can reject stale challenges
-- and open challenges can be reaped into status = 'expired'.

ALTER TABLE public.payment_records
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- Backfill open challenges that pre-date this column (10-minute default window).
UPDATE public.payment_records
SET expires_at = requested_at + INTERVAL '10 minutes'
WHERE expires_at IS NULL
  AND status IN ('challenge_issued', 'pending');

CREATE INDEX IF NOT EXISTS idx_payment_records_open_expires_at
  ON public.payment_records (expires_at)
  WHERE status IN ('challenge_issued', 'pending');
