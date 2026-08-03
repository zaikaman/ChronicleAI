-- Prevent one funding transaction from appearing as multiple desk capital moves.
-- Existing invalid/replayed rows must be removed before applying this migration.
CREATE UNIQUE INDEX IF NOT EXISTS idx_desk_capital_moves_tx_hash_unique
  ON public.desk_capital_moves (tx_hash)
  WHERE tx_hash IS NOT NULL;
