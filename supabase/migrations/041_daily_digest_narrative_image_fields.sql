-- daily_digests: market narrative sections + optional digest image fields.
-- Production already has these columns; this migration is idempotent so fresh
-- envs match, and the status CHECKs match what the API writes.

ALTER TABLE public.daily_digests
  ADD COLUMN IF NOT EXISTS market_narrative JSONB,
  ADD COLUMN IF NOT EXISTS market_narrative_provider TEXT,
  ADD COLUMN IF NOT EXISTS market_narrative_status TEXT,
  ADD COLUMN IF NOT EXISTS image_prompt TEXT,
  ADD COLUMN IF NOT EXISTS image_provider TEXT,
  ADD COLUMN IF NOT EXISTS image_status TEXT,
  ADD COLUMN IF NOT EXISTS image_url TEXT;

COMMENT ON COLUMN public.daily_digests.market_narrative IS
  'Sectioned digest body + precomputed stats (type=digest_sections).';
COMMENT ON COLUMN public.daily_digests.market_narrative_provider IS
  'LLM provider that produced market_narrative sections (gemini|openai|groq).';
COMMENT ON COLUMN public.daily_digests.market_narrative_status IS
  'Narrative generation outcome: succeeded | failed (NULL when unset).';
COMMENT ON COLUMN public.daily_digests.image_status IS
  'Digest image generation outcome: succeeded | failed (NULL when unset).';

-- Align CHECK with production + API (was rejecting 'ready').
ALTER TABLE public.daily_digests
  DROP CONSTRAINT IF EXISTS daily_digests_market_narrative_status_check;

ALTER TABLE public.daily_digests
  ADD CONSTRAINT daily_digests_market_narrative_status_check
  CHECK (
    market_narrative_status IS NULL
    OR market_narrative_status IN ('succeeded', 'failed')
  );

ALTER TABLE public.daily_digests
  DROP CONSTRAINT IF EXISTS daily_digests_image_status_check;

ALTER TABLE public.daily_digests
  ADD CONSTRAINT daily_digests_image_status_check
  CHECK (
    image_status IS NULL
    OR image_status IN ('succeeded', 'failed')
  );
