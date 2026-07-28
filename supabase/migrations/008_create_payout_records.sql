-- Migration: Create payout_records table
-- Tracks autonomous revenue distributions: creator recovery, referral rewards, and registry recordPayout calls

CREATE TABLE IF NOT EXISTS payout_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_period_hash TEXT NOT NULL,
  recipient TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  reason_hash TEXT NOT NULL,
  payout_tx_hash TEXT,
  registry_tx_hash TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'transferred', 'failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for looking up payouts by period
CREATE INDEX IF NOT EXISTS idx_payout_records_period_hash ON payout_records (payout_period_hash);

-- Index for listing recent payouts
CREATE INDEX IF NOT EXISTS idx_payout_records_created_at ON payout_records (created_at DESC);

-- Index for status filtering
CREATE INDEX IF NOT EXISTS idx_payout_records_status ON payout_records (status);

-- Add payout fields to treasury_snapshots for revenue routing tracking
ALTER TABLE treasury_snapshots ADD COLUMN IF NOT EXISTS last_routed_at TIMESTAMPTZ;
ALTER TABLE treasury_snapshots ADD COLUMN IF NOT EXISTS last_payout_period_hash TEXT;
ALTER TABLE treasury_snapshots ADD COLUMN IF NOT EXISTS total_routed_amount NUMERIC DEFAULT 0;

-- Execution log action types already include 'payout' via the existing enum constraint
-- Ensure the payout action_type is allowed in execution_logs
ALTER TABLE execution_logs DROP CONSTRAINT IF EXISTS execution_logs_action_type_check;
-- Note: The action_type enum constraint is handled at the application layer via the ExecutionLogActionType type
