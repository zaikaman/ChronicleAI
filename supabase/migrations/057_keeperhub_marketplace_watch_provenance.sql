-- KeeperHub Marketplace provenance and retry-safe registration for Watch.

ALTER TABLE public.sponsored_watches
  ADD COLUMN IF NOT EXISTS execution_source TEXT NOT NULL DEFAULT 'legacy_payment'
    CHECK (execution_source IN ('legacy_payment', 'keeperhub_marketplace')),
  ADD COLUMN IF NOT EXISTS marketplace_slug TEXT,
  ADD COLUMN IF NOT EXISTS marketplace_request_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sponsored_watches_marketplace_request_id
  ON public.sponsored_watches (marketplace_request_id)
  WHERE marketplace_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sponsored_watches_execution_source
  ON public.sponsored_watches (execution_source, created_at DESC);
