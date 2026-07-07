-- Bitget futures market intelligence platform: initial production schema (v1)
-- Tables: projects (tracked markets), trades, orderbook_snapshots,
-- open_interest, funding_rates. Trades/orderbook/OI/funding are partitioned
-- by month on their time column to keep ingestion and queries fast at scale.

create extension if not exists pgcrypto;

-- ============================================================
-- projects: registry of markets/instruments being ingested
-- ============================================================
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  exchange text not null default 'bitget',
  symbol text not null,
  contract_type text not null default 'perpetual',
  base_asset text not null,
  quote_asset text not null,
  is_active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (exchange, symbol)
);

create index idx_projects_active on public.projects (is_active) where is_active;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_projects_updated_at
before update on public.projects
for each row execute function public.set_updated_at();

-- ============================================================
-- trades: tick-level executed trades
-- ============================================================
create table public.trades (
  id bigint generated always as identity,
  project_id uuid not null references public.projects (id) on delete cascade,
  exchange_trade_id text not null,
  price numeric not null,
  size numeric not null,
  side text not null check (side in ('buy', 'sell')),
  traded_at timestamptz not null,
  ingested_at timestamptz not null default now(),
  primary key (id, traded_at)
) partition by range (traded_at);

create index idx_trades_project_time on public.trades (project_id, traded_at desc);
create unique index idx_trades_dedup on public.trades (project_id, exchange_trade_id, traded_at);

-- ============================================================
-- orderbook_snapshots: periodic L2 order book snapshots
-- ============================================================
create table public.orderbook_snapshots (
  id bigint generated always as identity,
  project_id uuid not null references public.projects (id) on delete cascade,
  snapshot_at timestamptz not null,
  best_bid numeric,
  best_ask numeric,
  spread numeric,
  depth_levels int not null default 0,
  bids jsonb not null,
  asks jsonb not null,
  ingested_at timestamptz not null default now(),
  primary key (id, snapshot_at)
) partition by range (snapshot_at);

create index idx_orderbook_project_time on public.orderbook_snapshots (project_id, snapshot_at desc);

-- ============================================================
-- open_interest: open interest history
-- ============================================================
create table public.open_interest (
  id bigint generated always as identity,
  project_id uuid not null references public.projects (id) on delete cascade,
  recorded_at timestamptz not null,
  open_interest numeric not null,
  open_interest_value numeric,
  ingested_at timestamptz not null default now(),
  primary key (id, recorded_at)
) partition by range (recorded_at);

create index idx_open_interest_project_time on public.open_interest (project_id, recorded_at desc);

-- ============================================================
-- funding_rates: funding rate history
-- ============================================================
create table public.funding_rates (
  id bigint generated always as identity,
  project_id uuid not null references public.projects (id) on delete cascade,
  funding_time timestamptz not null,
  funding_rate numeric not null,
  predicted_rate numeric,
  ingested_at timestamptz not null default now(),
  primary key (id, funding_time)
) partition by range (funding_time);

create index idx_funding_rates_project_time on public.funding_rates (project_id, funding_time desc);

-- ============================================================
-- Partition definitions: current + next month, plus a default
-- catch-all so ingestion never fails on an unexpected timestamp.
-- ============================================================
create table public.trades_default partition of public.trades default;
create table public.trades_y2026m07 partition of public.trades
  for values from ('2026-07-01') to ('2026-08-01');
create table public.trades_y2026m08 partition of public.trades
  for values from ('2026-08-01') to ('2026-09-01');

create table public.orderbook_snapshots_default partition of public.orderbook_snapshots default;
create table public.orderbook_snapshots_y2026m07 partition of public.orderbook_snapshots
  for values from ('2026-07-01') to ('2026-08-01');
create table public.orderbook_snapshots_y2026m08 partition of public.orderbook_snapshots
  for values from ('2026-08-01') to ('2026-09-01');

create table public.open_interest_default partition of public.open_interest default;
create table public.open_interest_y2026m07 partition of public.open_interest
  for values from ('2026-07-01') to ('2026-08-01');
create table public.open_interest_y2026m08 partition of public.open_interest
  for values from ('2026-08-01') to ('2026-09-01');

create table public.funding_rates_default partition of public.funding_rates default;
create table public.funding_rates_y2026m07 partition of public.funding_rates
  for values from ('2026-07-01') to ('2026-08-01');
create table public.funding_rates_y2026m08 partition of public.funding_rates
  for values from ('2026-08-01') to ('2026-09-01');

-- ============================================================
-- RLS scaffolding: service_role (ingestion backend) gets full
-- read/write, authenticated (dashboard/app users) gets read-only,
-- anon gets nothing by default.
-- ============================================================
alter table public.projects enable row level security;
alter table public.trades enable row level security;
alter table public.orderbook_snapshots enable row level security;
alter table public.open_interest enable row level security;
alter table public.funding_rates enable row level security;

create policy service_role_all on public.projects for all to service_role using (true) with check (true);
create policy authenticated_read on public.projects for select to authenticated using (true);

create policy service_role_all on public.trades for all to service_role using (true) with check (true);
create policy authenticated_read on public.trades for select to authenticated using (true);

create policy service_role_all on public.orderbook_snapshots for all to service_role using (true) with check (true);
create policy authenticated_read on public.orderbook_snapshots for select to authenticated using (true);

create policy service_role_all on public.open_interest for all to service_role using (true) with check (true);
create policy authenticated_read on public.open_interest for select to authenticated using (true);

create policy service_role_all on public.funding_rates for all to service_role using (true) with check (true);
create policy authenticated_read on public.funding_rates for select to authenticated using (true);
