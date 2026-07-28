-- Phase 4 surface diversity: premium receipt proof fields on payments,
-- registry audit fields on desk capital moves.

-- ── payment_records: on-chain publishPremiumReceipt proofs ──
ALTER TABLE public.payment_records
  ADD COLUMN IF NOT EXISTS registry_tx_hash TEXT,
  ADD COLUMN IF NOT EXISTS keeper_hub_run_id TEXT,
  ADD COLUMN IF NOT EXISTS explorer_url TEXT,
  ADD COLUMN IF NOT EXISTS content_uri TEXT;

COMMENT ON COLUMN public.payment_records.registry_tx_hash IS
  'ChronicleRegistry publishPremiumReceipt transaction hash (soft-fail; settlement still succeeds without it).';
COMMENT ON COLUMN public.payment_records.keeper_hub_run_id IS
  'KeeperHub run id for the premium receipt registry write.';
COMMENT ON COLUMN public.payment_records.explorer_url IS
  'Block explorer URL for the premium receipt registry tx.';
COMMENT ON COLUMN public.payment_records.content_uri IS
  'HTTPS content URI written on-chain with publishPremiumReceipt.';

CREATE INDEX IF NOT EXISTS idx_payment_records_registry_tx_hash
  ON public.payment_records (registry_tx_hash)
  WHERE registry_tx_hash IS NOT NULL;

-- ── desk_capital_moves: recordCapitalMove audit proof ──
ALTER TABLE public.desk_capital_moves
  ADD COLUMN IF NOT EXISTS registry_tx_hash TEXT,
  ADD COLUMN IF NOT EXISTS keeper_hub_run_id TEXT,
  ADD COLUMN IF NOT EXISTS registry_explorer_url TEXT;

COMMENT ON COLUMN public.desk_capital_moves.registry_tx_hash IS
  'ChronicleRegistry recordCapitalMove audit transaction hash (distinct from transfer tx_hash).';
COMMENT ON COLUMN public.desk_capital_moves.keeper_hub_run_id IS
  'KeeperHub run id for the capital-move registry audit write.';
COMMENT ON COLUMN public.desk_capital_moves.registry_explorer_url IS
  'Block explorer URL for the capital-move registry audit tx.';

CREATE INDEX IF NOT EXISTS idx_desk_capital_moves_registry_tx_hash
  ON public.desk_capital_moves (registry_tx_hash)
  WHERE registry_tx_hash IS NOT NULL;
