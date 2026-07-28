-- P2-4: Standardize money / quantity columns to NUMERIC (not DOUBLE PRECISION).
-- Aligns payments, treasury, desk, and newsletter with affiliate/CCTP NUMERIC money types.

-- ── Core money columns ──────────────────────────────────
ALTER TABLE public.premium_intelligence_items
  ALTER COLUMN price_amount TYPE NUMERIC(36, 6)
  USING price_amount::numeric(36, 6);

ALTER TABLE public.payment_records
  ALTER COLUMN amount_requested TYPE NUMERIC(36, 6)
  USING amount_requested::numeric(36, 6);

ALTER TABLE public.payment_records
  ALTER COLUMN amount_settled TYPE NUMERIC(36, 6)
  USING amount_settled::numeric(36, 6);

ALTER TABLE public.treasury_snapshots
  ALTER COLUMN available_balance TYPE NUMERIC(36, 6)
  USING available_balance::numeric(36, 6);

ALTER TABLE public.treasury_snapshots
  ALTER COLUMN safety_buffer TYPE NUMERIC(36, 6)
  USING safety_buffer::numeric(36, 6);

ALTER TABLE public.treasury_snapshots
  ALTER COLUMN revenue_total TYPE NUMERIC(36, 6)
  USING revenue_total::numeric(36, 6);

ALTER TABLE public.treasury_snapshots
  ALTER COLUMN estimated_generation_cost TYPE NUMERIC(36, 6)
  USING estimated_generation_cost::numeric(36, 6);

ALTER TABLE public.treasury_snapshots
  ALTER COLUMN estimated_transaction_cost TYPE NUMERIC(36, 6)
  USING estimated_transaction_cost::numeric(36, 6);

-- ── Newsletter ──────────────────────────────────────────
ALTER TABLE public.x402_newsletter_subscriptions
  ALTER COLUMN amount_per_period TYPE NUMERIC(36, 6)
  USING amount_per_period::numeric(36, 6);

-- ── Desk ────────────────────────────────────────────────
ALTER TABLE public.desk_intents
  ALTER COLUMN notional_usdc TYPE NUMERIC(36, 6)
  USING notional_usdc::numeric(36, 6);

ALTER TABLE public.desk_positions
  ALTER COLUMN usdc TYPE NUMERIC(36, 6)
  USING usdc::numeric(36, 6);

ALTER TABLE public.desk_positions
  ALTER COLUMN weth TYPE NUMERIC(36, 18)
  USING weth::numeric(36, 18);

ALTER TABLE public.desk_positions
  ALTER COLUMN link TYPE NUMERIC(36, 18)
  USING link::numeric(36, 18);

ALTER TABLE public.desk_positions
  ALTER COLUMN equity_usdc TYPE NUMERIC(36, 6)
  USING equity_usdc::numeric(36, 6);

ALTER TABLE public.desk_capital_moves
  ALTER COLUMN amount_usdc TYPE NUMERIC(36, 6)
  USING amount_usdc::numeric(36, 6);

ALTER TABLE public.desk_capital_moves
  ALTER COLUMN treasury_usdc_after TYPE NUMERIC(36, 6)
  USING treasury_usdc_after::numeric(36, 6);

ALTER TABLE public.desk_capital_moves
  ALTER COLUMN desk_equity_after TYPE NUMERIC(36, 6)
  USING desk_equity_after::numeric(36, 6);

-- significance_score stays DOUBLE PRECISION (score, not money).
