-- Unified Sepolia intelligence evidence and causal desk linkage.
-- Mainnet rows remain available for explicit historical/legacy queries; the
-- application-level active scope is Ethereum Sepolia (11155111).

alter table public.monitored_events
  add column if not exists block_number bigint,
  add column if not exists block_hash text,
  add column if not exists log_index bigint,
  add column if not exists source_contract text,
  add column if not exists normalized_evidence jsonb not null default '{}'::jsonb,
  add column if not exists source_dedupe_key text;

alter table public.public_alerts
  add column if not exists alert_kind text not null default 'market_event',
  add column if not exists event_type text,
  add column if not exists chain_id bigint,
  add column if not exists publication_chain_id bigint not null default 11155111,
  add column if not exists source_dedupe_key text,
  add column if not exists desk_signal_id uuid,
  add column if not exists signal_type text,
  add column if not exists signal_status text not null default 'not_eligible',
  add column if not exists policy_verdict text,
  add column if not exists action_status text not null default 'not_created',
  add column if not exists intent_id uuid,
  add column if not exists ticket_id uuid,
  add column if not exists transaction_hash text,
  add column if not exists action_transaction_hash text,
  add column if not exists action_keeper_hub_run_id text,
  add column if not exists action_explorer_url text,
  add column if not exists deterministic_evidence jsonb not null default '{}'::jsonb;

update public.public_alerts pa
set chain_id = me.chain_id
from public.monitored_events me
where pa.monitored_event_id = me.id
  and pa.chain_id is null;

update public.public_alerts pa
set event_type = me.event_type
from public.monitored_events me
where pa.monitored_event_id = me.id
  and pa.event_type is null;

update public.public_alerts
set source_dedupe_key = coalesce(source_dedupe_key, dedupe_key)
where source_dedupe_key is null;

update public.public_alerts pa
set transaction_hash = me.transaction_hash
from public.monitored_events me
where pa.monitored_event_id = me.id
  and pa.transaction_hash is null;

alter table public.public_alerts
  drop constraint if exists public_alerts_alert_kind_check,
  drop constraint if exists public_alerts_signal_status_check,
  drop constraint if exists public_alerts_action_status_check,
  add constraint public_alerts_alert_kind_check
    check (alert_kind in ('market_event', 'desk_trigger')),
  add constraint public_alerts_signal_status_check
    check (signal_status in ('not_eligible', 'pending', 'created', 'failed')),
  add constraint public_alerts_action_status_check
    check (action_status in ('not_created', 'pending', 'submitted', 'filled', 'failed', 'deferred', 'ignored'));

alter table public.desk_signals
  drop constraint if exists desk_signals_signal_origin_check,
  add column if not exists source_alert_id uuid,
  add column if not exists source_event_id text,
  add column if not exists signal_origin text not null default 'manual',
  add column if not exists source_dedupe_key text,
  add column if not exists source_evidence jsonb not null default '{}'::jsonb;

alter table public.desk_signals
  add constraint desk_signals_signal_origin_check
    check (signal_origin in ('alert', 'desk_read', 'manual'));

alter table public.daily_digests
  drop constraint if exists daily_digests_digest_kind_check,
  add column if not exists digest_kind text not null default 'market',
  add column if not exists chain_id bigint not null default 11155111,
  add column if not exists publication_chain_id bigint not null default 11155111,
  add column if not exists source_alert_ids uuid[] not null default '{}',
  add column if not exists source_signal_ids uuid[] not null default '{}',
  add column if not exists source_intent_ids uuid[] not null default '{}',
  add column if not exists source_ticket_ids uuid[] not null default '{}';

alter table public.daily_digests
  add constraint daily_digests_digest_kind_check
    check (digest_kind in ('market', 'desk'));

-- Existing digest and premium rows are historical snapshots. Preserve their
-- source-chain scope instead of letting the new active-chain defaults relabel
-- Mainnet source material as Sepolia.
update public.daily_digests d
set chain_id = 1
where exists (
  select 1
  from public.monitored_events me
  where me.id = any(d.source_event_ids)
    and me.chain_id = 1
);

drop index if exists public.idx_daily_digests_report_window;
create unique index if not exists idx_daily_digests_report_window_kind
  on public.daily_digests (period_start, period_end, digest_kind);

alter table public.premium_intelligence_items
  add column if not exists source_chain_id bigint not null default 11155111;

update public.premium_intelligence_items p
set source_chain_id = 1
where exists (
  select 1
  from public.monitored_events me
  where me.id = any(p.source_event_ids)
    and me.chain_id = 1
);

create index if not exists monitored_events_active_chain_window_idx
  on public.monitored_events (chain_id, captured_at desc);
create index if not exists public_alerts_active_chain_feed_idx
  on public.public_alerts (chain_id, published_at desc);
create index if not exists public_alerts_source_dedupe_idx
  on public.public_alerts (source_dedupe_key);
create index if not exists desk_signals_source_alert_idx
  on public.desk_signals (source_alert_id);
create unique index if not exists desk_signals_one_alert_projection_idx
  on public.desk_signals (source_alert_id)
  where source_alert_id is not null;
create index if not exists daily_digests_chain_kind_idx
  on public.daily_digests (chain_id, digest_kind, published_at desc);
create index if not exists premium_intelligence_source_chain_idx
  on public.premium_intelligence_items (source_chain_id, created_at desc);
