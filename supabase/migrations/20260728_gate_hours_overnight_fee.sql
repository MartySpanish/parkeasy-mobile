-- Gate hours + overnight lock-in fee on listings.
-- APPLIED to production project bbgqregyogtjzaustbng on 28 Jul 2026.
--
-- Belfast Royal Academy, signed 28 Jul 2026: 64 spaces, £15/day, 08:00-17:00
-- Mon-Fri, gates locked 17:00 Friday to 08:00 Monday, and a £10 fee for any
-- vehicle left in after the gates close — collected by ParkEasy and paid to the
-- Academy IN FULL.
--
-- "In full" is the load-bearing part: the surcharge sits OUTSIDE the 15%
-- commission base. Taking a cut of it would breach the signed agreement.

alter table public.rental_listings
  add column if not exists gate_closes_at      time,
  add column if not exists gate_opens_at       time,
  add column if not exists overnight_fee_pence integer not null default 0,
  add column if not exists available_days      smallint[];

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rental_listings_overnight_fee_sane') then
    alter table public.rental_listings
      add constraint rental_listings_overnight_fee_sane
      check (overnight_fee_pence >= 0 and overnight_fee_pence <= 10000);
  end if;
end $$;

-- CREATE OR REPLACE cannot insert columns mid-list, so drop and rebuild. Safe:
-- the client still reads rental_listings directly, so nothing depends on the
-- view yet. The gate times and fee are in it so a driver sees them BEFORE
-- booking rather than after they are locked in.
drop view if exists public.listings_public;
create view public.listings_public
with (security_invoker = true) as
select
  id, title, description, address, lat, lng,
  space_type, host_type, spaces,
  price_per_hour, price_per_day, price_per_month,
  amenities, photos, availability,
  gate_opens_at, gate_closes_at, overnight_fee_pence, available_days,
  is_verified, verified_org_type,
  completed_bookings_count, average_rating, ratings_count,
  published_at, created_at
from public.rental_listings
where status = 'active';

grant select on public.listings_public to anon, authenticated;
