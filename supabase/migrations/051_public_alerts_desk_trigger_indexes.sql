-- Desk-trigger Alert feed indexes and lookup keys.
-- Future-only: no historical Desk decisions are backfilled.

-- Kind + published_at for market/desk scope filters (newest-first).
create index if not exists public_alerts_alert_kind_published_at_idx
  on public.public_alerts (alert_kind, published_at desc nulls last);

-- Execution callback lookups when no Desk Signal exists.
create index if not exists public_alerts_intent_id_idx
  on public.public_alerts (intent_id)
  where intent_id is not null;

create index if not exists public_alerts_ticket_id_idx
  on public.public_alerts (ticket_id)
  where ticket_id is not null;

-- Unified feed: Mainnet market_event + Sepolia desk_trigger ordered by published_at.
create index if not exists public_alerts_unified_feed_idx
  on public.public_alerts (chain_id, alert_kind, published_at desc nulls last)
  where delivery_status not in ('draft', 'queued');

-- Source dedupe reuse for Desk-trigger polls / capital ticks.
create index if not exists public_alerts_source_dedupe_key_idx
  on public.public_alerts (source_dedupe_key)
  where source_dedupe_key is not null;
