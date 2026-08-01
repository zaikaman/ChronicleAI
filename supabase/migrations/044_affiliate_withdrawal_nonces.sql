create table if not exists public.affiliate_withdrawal_nonces (
  nonce text primary key,
  affiliate_wallet text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists affiliate_withdrawal_nonces_expiry_idx on public.affiliate_withdrawal_nonces (expires_at);
alter table public.affiliate_withdrawal_nonces enable row level security;
alter table public.affiliate_withdrawal_nonces force row level security;
