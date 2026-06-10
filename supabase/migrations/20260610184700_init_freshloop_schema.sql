create extension if not exists pgcrypto;

create schema if not exists private;

create type public.retailer_type as enum ('instamart', 'blinkit');
create type public.purchase_status as enum ('matched', 'unmatched', 'needs_review');
create type public.gmail_connection_status as enum ('active', 'revoked', 'error');
create type public.household_role as enum ('owner', 'member');

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  email text not null,
  display_name text,
  role public.household_role not null default 'member',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, email)
);

create table public.gmail_connections (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  gmail_address text not null,
  refresh_token_ciphertext text not null,
  last_history_id text,
  last_checked_at timestamptz,
  status public.gmail_connection_status not null default 'active',
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, gmail_address)
);

create table public.inventory_items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  item_name text not null,
  normalized_name text not null,
  category text not null default 'uncategorized',
  unit text not null default 'unit',
  default_shelf_life_days integer not null default 180 check (default_shelf_life_days > 0),
  essential_to_refill boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, normalized_name)
);

create table public.item_aliases (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  alias text not null,
  normalized_alias text not null,
  created_at timestamptz not null default now(),
  unique (household_id, normalized_alias)
);

create table public.inventory_stock (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  item_id uuid not null references public.inventory_items(id) on delete cascade,
  quantity numeric(12, 3) not null default 0,
  expiry_date date not null,
  last_updated_at timestamptz not null default now(),
  check (quantity >= 0),
  unique (household_id, item_id, expiry_date)
);

create table public.purchase_log (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  gmail_connection_id uuid references public.gmail_connections(id) on delete set null,
  retailer public.retailer_type not null,
  order_date timestamptz not null,
  raw_product_name text not null,
  matched_item_id uuid references public.inventory_items(id) on delete set null,
  quantity numeric(12, 3) not null default 1,
  price numeric(12, 2),
  status public.purchase_status not null,
  source_message_id text,
  source_line_hash text not null,
  created_at timestamptz not null default now(),
  unique (household_id, retailer, source_message_id, source_line_hash)
);

create table public.parser_runs (
  id uuid primary key default gen_random_uuid(),
  household_id uuid references public.households(id) on delete cascade,
  retailer public.retailer_type not null,
  user_id uuid references public.users(id) on delete set null,
  run_at timestamptz not null default now(),
  emails_scanned integer not null default 0 check (emails_scanned >= 0),
  items_extracted integer not null default 0 check (items_extracted >= 0),
  errors jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger users_set_updated_at
before update on public.users
for each row execute function private.set_updated_at();

create trigger gmail_connections_set_updated_at
before update on public.gmail_connections
for each row execute function private.set_updated_at();

create trigger inventory_items_set_updated_at
before update on public.inventory_items
for each row execute function private.set_updated_at();

create or replace function private.user_household_ids()
returns setof uuid
language sql
security definer
set search_path = public
stable
as $$
  select household_id
  from public.users
  where id = (select auth.uid())
$$;

revoke all on function private.user_household_ids() from public;
grant execute on function private.user_household_ids() to authenticated;

alter table public.households enable row level security;
alter table public.users enable row level security;
alter table public.gmail_connections enable row level security;
alter table public.inventory_items enable row level security;
alter table public.item_aliases enable row level security;
alter table public.inventory_stock enable row level security;
alter table public.purchase_log enable row level security;
alter table public.parser_runs enable row level security;

grant usage on schema public to authenticated;
grant select, insert, update, delete on
  public.households,
  public.users,
  public.gmail_connections,
  public.inventory_items,
  public.item_aliases,
  public.inventory_stock,
  public.purchase_log,
  public.parser_runs
to authenticated;

create policy "household members can read their households"
on public.households
for select
to authenticated
using (id in (select private.user_household_ids()));

create policy "members can read profiles in their household"
on public.users
for select
to authenticated
using (household_id in (select private.user_household_ids()));

create policy "members can update their own profile"
on public.users
for update
to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()) and household_id in (select private.user_household_ids()));

create policy "members can read gmail connections in their household"
on public.gmail_connections
for select
to authenticated
using (household_id in (select private.user_household_ids()));

create policy "members can manage inventory items in their household"
on public.inventory_items
for all
to authenticated
using (household_id in (select private.user_household_ids()))
with check (household_id in (select private.user_household_ids()));

create policy "members can manage aliases in their household"
on public.item_aliases
for all
to authenticated
using (household_id in (select private.user_household_ids()))
with check (household_id in (select private.user_household_ids()));

create policy "members can manage stock in their household"
on public.inventory_stock
for all
to authenticated
using (household_id in (select private.user_household_ids()))
with check (household_id in (select private.user_household_ids()));

create policy "members can read purchase logs in their household"
on public.purchase_log
for select
to authenticated
using (household_id in (select private.user_household_ids()));

create policy "members can update review fields on purchase logs"
on public.purchase_log
for update
to authenticated
using (household_id in (select private.user_household_ids()))
with check (household_id in (select private.user_household_ids()));

create policy "members can read parser runs in their household"
on public.parser_runs
for select
to authenticated
using (household_id in (select private.user_household_ids()));

create index users_household_id_idx on public.users (household_id);
create index gmail_connections_household_status_idx on public.gmail_connections (household_id, status);
create index inventory_items_household_category_idx on public.inventory_items (household_id, category);
create index item_aliases_household_item_idx on public.item_aliases (household_id, item_id);
create index inventory_stock_household_expiry_idx on public.inventory_stock (household_id, expiry_date);
create index inventory_stock_household_item_idx on public.inventory_stock (household_id, item_id);
create index purchase_log_household_order_date_idx on public.purchase_log (household_id, order_date desc);
create index purchase_log_household_status_idx on public.purchase_log (household_id, status);
create index parser_runs_household_run_at_idx on public.parser_runs (household_id, run_at desc);
