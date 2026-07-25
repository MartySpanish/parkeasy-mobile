-- Season/bundle passes: a driver buys N booking credits for a listing at a
-- host-set price, then redeems one credit per booking instead of paying again.
-- Fee decision (per brief recommendation): the 15% commission + £1 driver
-- service fee are charged ONCE at pass purchase; redemptions are free.
-- Unused credits past valid_to are not refunded (stated at purchase).

create table if not exists public.listing_passes (
  id          uuid primary key default gen_random_uuid(),
  listing_id  uuid not null references public.rental_listings(id) on delete cascade,
  name        text not null,
  num_credits integer not null check (num_credits between 1 and 100),
  price_pence integer not null check (price_pence > 0),
  valid_from  date,
  valid_to    date,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

alter table public.listing_passes enable row level security;

drop policy if exists "passes_public_read" on public.listing_passes;
create policy "passes_public_read" on public.listing_passes
  for select to anon, authenticated using (active);

drop policy if exists "passes_owner_write" on public.listing_passes;
create policy "passes_owner_write" on public.listing_passes
  for insert to authenticated
  with check (exists (select 1 from public.rental_listings l where l.id = listing_id and l.owner_id = auth.uid()));
drop policy if exists "passes_owner_update" on public.listing_passes;
create policy "passes_owner_update" on public.listing_passes
  for update to authenticated
  using (exists (select 1 from public.rental_listings l where l.id = listing_id and l.owner_id = auth.uid()));

create table if not exists public.pass_purchases (
  id                       uuid primary key default gen_random_uuid(),
  pass_id                  uuid not null references public.listing_passes(id) on delete cascade,
  driver_id                uuid not null references auth.users(id) on delete cascade,
  stripe_session_id        text unique,
  stripe_payment_intent_id text,
  credits_remaining        integer not null check (credits_remaining >= 0),
  purchased_at             timestamptz not null default now()
);

alter table public.pass_purchases enable row level security;

-- Drivers read their own purchases; all writes happen server-side.
drop policy if exists "own_pass_purchases_readable" on public.pass_purchases;
create policy "own_pass_purchases_readable" on public.pass_purchases
  for select using (auth.uid() = driver_id);

create index if not exists pass_purchases_driver_idx on public.pass_purchases (driver_id, pass_id);

alter table public.bookings
  add column if not exists pass_purchase_id uuid references public.pass_purchases(id) on delete set null;

-- Atomic credit decrement — never lets credits go negative under concurrency.
create or replace function public.redeem_pass_credit(p_purchase uuid)
returns integer
language sql
security definer
set search_path = public
as $$
  update public.pass_purchases
     set credits_remaining = credits_remaining - 1
   where id = p_purchase and credits_remaining > 0
  returning credits_remaining;
$$;

revoke all on function public.redeem_pass_credit(uuid) from public, anon, authenticated;
