-- Allow premium deep-dive / historical narrative LLM attempts to be audited
-- alongside public alerts and digests.

ALTER TABLE public.llm_generation_attempts
  DROP CONSTRAINT IF EXISTS llm_generation_attempts_entity_type_check;

ALTER TABLE public.llm_generation_attempts
  ADD CONSTRAINT llm_generation_attempts_entity_type_check
  CHECK (entity_type IN ('public_alert', 'daily_digest', 'premium_intelligence_item'));
