-- Migration: CCTP rebalance transfers (Base Sepolia → Ethereum Sepolia)
-- Plan: docs/CCTP-TREASURY-REBALANCE-PLAN.md §6

CREATE TABLE IF NOT EXISTS public.cctp_rebalance_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending',
    'approving',
    'burning',
    'awaiting_attestation',
    'minting',
    'minted',
    'failed',
    'stuck'
  )),
  direction TEXT NOT NULL DEFAULT 'base_to_sepolia' CHECK (direction IN (
    'base_to_sepolia'
  )),
  source_domain INTEGER NOT NULL DEFAULT 6,
  destination_domain INTEGER NOT NULL DEFAULT 0,
  source_chain_id INTEGER NOT NULL DEFAULT 84532,
  destination_chain_id INTEGER NOT NULL DEFAULT 11155111,
  amount_usdc NUMERIC(36, 6) NOT NULL CHECK (amount_usdc > 0),
  amount_atomic TEXT NOT NULL,
  max_fee_atomic TEXT,
  min_finality_threshold INTEGER,
  mode TEXT NOT NULL CHECK (mode IN ('direct', 'forwarding')),
  treasury_address TEXT NOT NULL,
  mint_recipient TEXT NOT NULL,
  approve_tx_hash TEXT,
  burn_tx_hash TEXT,
  message_bytes TEXT,
  attestation TEXT,
  message_hash TEXT,
  mint_tx_hash TEXT,
  iris_status TEXT,
  error_message TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  burned_at TIMESTAMPTZ,
  attested_at TIMESTAMPTZ,
  minted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_cctp_rebalance_transfers_status_created
  ON public.cctp_rebalance_transfers (status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cctp_rebalance_transfers_burn_tx_hash
  ON public.cctp_rebalance_transfers (burn_tx_hash)
  WHERE burn_tx_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cctp_rebalance_transfers_treasury_created
  ON public.cctp_rebalance_transfers (treasury_address, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cctp_rebalance_transfers_in_flight
  ON public.cctp_rebalance_transfers (created_at DESC)
  WHERE status IN (
    'pending',
    'approving',
    'burning',
    'awaiting_attestation',
    'minting',
    'stuck'
  );
