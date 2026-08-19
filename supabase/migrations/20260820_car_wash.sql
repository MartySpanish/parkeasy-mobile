-- Car wash add-on, manual v1.
--
-- APPLIED to production project bbgqregyogtjzaustbng on 19 Aug 2026.
--
-- DELIBERATELY NOT AUTOMATED. No valeter accounts, no scheduling engine, no
-- payment split. A driver ticks a box, ParkEasy takes the money, and Marty
-- hands a list of registrations to a valeter. Everything else is an
-- optimisation of a service nobody has bought yet.
--
-- PARKEASY IS A BOOKING AGENT HERE, NOT THE SERVICE PROVIDER. The wash is
-- carried out by an independent contractor and the contract for it is between
-- the driver and them. That is why this money does not touch Connect and does
-- not split: ParkEasy is arranging, not performing. The copy has to say so
-- wherever a driver can tick the box.

--------------------------------------------------------------------------------
-- 1. Which sites, and on which days
--------------------------------------------------------------------------------
alter table public.rental_listings
  add column if not exists wash_enabled boolean not null default false,
  -- ISO weekday numbers (1 = Monday ... 7 = Sunday).
  --
  -- A COLUMN, NOT A CONSTANT. Mondays is where this starts, but event sites are
  -- the obvious second case and those are Sundays. "Monday" hardcoded in three
  -- files is how a per-site decision becomes a deploy.
  add column if not exists wash_days smallint[] not null default '{1}';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rental_listings_wash_days_valid') then
    alter table public.rental_listings
      add constraint rental_listings_wash_days_valid
      check (wash_days <@ array[1,2,3,4,5,6,7]::smallint[]);
  end if;
end $$;

comment on column public.rental_listings.wash_days is
  'ISO weekdays a wash can be booked at this site (1=Mon..7=Sun). Per listing on '
  'purpose: Mondays is where this starts, event sites will want Sundays, and a '
  'hardcoded constant turns a per-site decision into a deploy.';

--------------------------------------------------------------------------------
-- 2. The requests
--------------------------------------------------------------------------------
create table if not exists public.wash_requests (
  id              uuid primary key default gen_random_uuid(),
  -- Nullable, and so is permit_claim_id: a driver has a booking, a corporate
  -- permit holder has a CLAIM and no booking at all. Exactly one of the two.
  booking_id      uuid references public.bookings(id) on delete set null,
  permit_claim_id uuid references public.permit_claims(id) on delete set null,
  user_id         uuid references auth.users(id) on delete set null,
  listing_id      uuid not null references public.rental_listings(id) on delete restrict,
  wash_date       date not null,
  vehicle_tier    text not null check (vehicle_tier in ('standard','large','van')),
  price_pence     integer not null check (price_pence > 0),
  status          text not null default 'requested'
                    check (status in ('requested','confirmed','completed','cancelled')),
  vrn             text not null,
  notes           text,
  -- 100% ParkEasy. No host split, no application fee, no destination — this is
  -- not a booking and the host's 85% has nothing to do with it.
  stripe_session_id       text unique,
  stripe_payment_intent   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint wash_request_has_an_origin
    check (num_nonnulls(booking_id, permit_claim_id) = 1)
);

create index if not exists wash_requests_date_idx
  on public.wash_requests (wash_date, listing_id) where status <> 'cancelled';
create index if not exists wash_requests_user_idx
  on public.wash_requests (user_id, wash_date desc);

-- Normalise the plate the same way everything else does, so the valeter's list
-- and the permit list agree about what a registration looks like.
create or replace function public.wash_requests_normalise()
returns trigger language plpgsql as $$
begin
  new.vrn := public.normalise_vrn(new.vrn);
  if new.vrn is null then
    raise exception 'A vehicle registration is required for a wash.';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists wash_requests_normalise_t on public.wash_requests;
create trigger wash_requests_normalise_t
  before insert or update on public.wash_requests
  for each row execute function public.wash_requests_normalise();

--------------------------------------------------------------------------------
-- 3. The wash day has to be a day this site washes
--------------------------------------------------------------------------------
-- Checked in the database as well as the endpoint. The endpoint is where the
-- friendly message comes from; this is what stops a backfill, an admin tool or
-- a future second client quietly booking a valeter for a Thursday nobody is
-- working.
create or replace function public.guard_wash_day()
returns trigger language plpgsql as $$
declare v_days smallint[]; v_enabled boolean;
begin
  select wash_days, wash_enabled into v_days, v_enabled
    from public.rental_listings where id = new.listing_id;

  if not coalesce(v_enabled, false) then
    raise exception 'This site does not offer washes.' using errcode = 'PE020';
  end if;
  if not (extract(isodow from new.wash_date)::smallint = any(v_days)) then
    raise exception 'This site does not wash on that day.' using errcode = 'PE021';
  end if;
  return new;
end $$;

drop trigger if exists guard_wash_day_t on public.wash_requests;
create trigger guard_wash_day_t
  before insert or update of wash_date, listing_id on public.wash_requests
  for each row execute function public.guard_wash_day();

--------------------------------------------------------------------------------
-- 4. RLS
--------------------------------------------------------------------------------
alter table public.wash_requests enable row level security;

-- A driver reads their own; everything is written server-side, where the
-- cutoff and the price live.
drop policy if exists wash_requests_own_read on public.wash_requests;
create policy wash_requests_own_read on public.wash_requests
  for select using (user_id = auth.uid());

revoke all on public.wash_requests from anon;
grant select on public.wash_requests to authenticated;
