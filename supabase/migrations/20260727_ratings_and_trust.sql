-- Items 5 + 6: trust signals on listing cards, and two-way star ratings.
--
-- Ratings are mutual but asymmetric in visibility:
--   driver_to_host → aggregated onto the listing, shown publicly
--   host_to_driver → aggregated onto the driver, shown only to that driver
--                    (and later as an input to a host-side risk flag)
create extension if not exists pgcrypto;

-- ── Item 5: trust signals ────────────────────────────────────────────────
alter table public.rental_listings
  add column if not exists is_verified              boolean not null default false,
  add column if not exists verified_org_type        text,
  add column if not exists completed_bookings_count integer not null default 0,
  add column if not exists average_rating           numeric(3,2),
  add column if not exists ratings_count            integer not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rental_listings_org_type_chk') then
    alter table public.rental_listings
      add constraint rental_listings_org_type_chk
      check (verified_org_type is null or verified_org_type in ('club','church','school','other'));
  end if;
end
$$;

-- Driver-side aggregate (visible only to the driver themselves).
create table if not exists public.driver_profiles (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  average_rating numeric(3,2),
  ratings_count  integer not null default 0,
  updated_at     timestamptz not null default now()
);
alter table public.driver_profiles enable row level security;
drop policy if exists "own driver profile readable" on public.driver_profiles;
create policy "own driver profile readable" on public.driver_profiles
  for select using (auth.uid() = user_id);

-- ── Item 6: ratings ──────────────────────────────────────────────────────
create table if not exists public.ratings (
  id         uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  rater_id   uuid not null references auth.users(id) on delete cascade,
  ratee_id   uuid          references auth.users(id) on delete set null,
  listing_id uuid          references public.rental_listings(id) on delete cascade,
  direction  text not null check (direction in ('driver_to_host','host_to_driver')),
  stars      integer not null check (stars between 1 and 5),
  comment    text check (comment is null or char_length(comment) <= 500),
  created_at timestamptz not null default now(),
  -- One rating per direction per booking; no resubmission in v1.
  constraint ratings_booking_direction_uniq unique (booking_id, direction)
);

create index if not exists ratings_listing_idx on public.ratings (listing_id) where direction = 'driver_to_host';
create index if not exists ratings_ratee_idx   on public.ratings (ratee_id)   where direction = 'host_to_driver';

alter table public.ratings enable row level security;

-- Public can read the driver→host ratings (they're the public trust signal).
drop policy if exists "public read host ratings" on public.ratings;
create policy "public read host ratings" on public.ratings
  for select to anon, authenticated using (direction = 'driver_to_host');

-- A user can always read ratings they wrote or received.
drop policy if exists "own ratings readable" on public.ratings;
create policy "own ratings readable" on public.ratings
  for select to authenticated using (auth.uid() = rater_id or auth.uid() = ratee_id);

-- Insert is server-side only (the API verifies the rater is a party to the
-- booking and that the booking is in a terminal state) — no client policy.

-- ── Aggregate recomputation ──────────────────────────────────────────────
create or replace function public.recompute_rating_aggregates()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.direction = 'driver_to_host' and new.listing_id is not null then
    update public.rental_listings l
       set average_rating = sub.avg_stars, ratings_count = sub.n
      from (select round(avg(stars)::numeric, 2) as avg_stars, count(*) as n
              from public.ratings
             where listing_id = new.listing_id and direction = 'driver_to_host') sub
     where l.id = new.listing_id;
  elsif new.direction = 'host_to_driver' and new.ratee_id is not null then
    insert into public.driver_profiles (user_id, average_rating, ratings_count, updated_at)
    select new.ratee_id, round(avg(stars)::numeric, 2), count(*), now()
      from public.ratings where ratee_id = new.ratee_id and direction = 'host_to_driver'
    on conflict (user_id) do update
      set average_rating = excluded.average_rating,
          ratings_count  = excluded.ratings_count,
          updated_at     = now();
  end if;
  return new;
end
$$;

drop trigger if exists ratings_aggregate_trg on public.ratings;
create trigger ratings_aggregate_trg
  after insert on public.ratings
  for each row execute function public.recompute_rating_aggregates();

-- ── completed_bookings_count: only real completions count ────────────────
create or replace function public.bump_completed_bookings()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'completed' and coalesce(old.status, '') is distinct from 'completed'
     and new.listing_id is not null then
    update public.rental_listings
       set completed_bookings_count = completed_bookings_count + 1
     where id = new.listing_id;
  end if;
  return new;
end
$$;

drop trigger if exists bookings_completed_trg on public.bookings;
create trigger bookings_completed_trg
  after update on public.bookings
  for each row execute function public.bump_completed_bookings();
