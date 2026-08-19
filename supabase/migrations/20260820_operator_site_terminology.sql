-- Terminology: "held for you" is a promise ParkEasy can only make at its own
-- sites.
--
-- APPLIED to production project bbgqregyogtjzaustbng on 19 Aug 2026.
--
-- THE PROBLEM. Two places in the app describe a bookable space as "reserved in
-- advance and held for you when you arrive". That is completely true of Davitt
-- Park and Belfast Royal Academy: those are host sites, ParkEasy has a signed
-- agreement covering the whole car park, and the host holds the space.
--
-- It would be false at a commercial operator's car park. Operators oversell
-- deliberately and their own terms say a season ticket "does not guarantee you
-- a space" — what they sell is entry, not a specific bay. And there are already
-- two APCOA rental_listings sitting in this database at status='draft'. The day
-- either is switched to 'active', both of those sentences start appearing over
-- an APCOA car park, unchanged, with nobody having decided to say it.
--
-- So the distinction gets a column rather than a convention. A convention is
-- something you remember; a column is something the code can ask.
alter table public.rental_listings
  add column if not exists is_operator_site boolean not null default false;

comment on column public.rental_listings.is_operator_site is
  'True for a commercial car park operator''s site (APCOA, NCP, Q-Park). At these '
  'sites ParkEasy sells guaranteed ACCESS against a quota, never a held space — the '
  'operator controls the car park and oversells it. False for host sites (clubs, '
  'churches, schools, driveways) where ParkEasy''s agreement covers the whole car '
  'park and the space genuinely is held.';

-- Flag the operator listings that already exist. Keyed on the operator's name in
-- the title, which is how they were created; deliberately narrow, so it cannot
-- catch a club whose car park happens to be near one.
update public.rental_listings
   set is_operator_site = true
 where is_operator_site = false
   and (title ilike '%APCOA%' or title ilike '%NCP%' or title ilike '%Q-Park%');

-- listings_public is what the browser reads, so the flag has to be on it or the
-- app cannot tell the two kinds of site apart. A view cannot have a column
-- added any other way, so it is recreated in full.
--
-- READ THIS BEFORE EDITING THE COLUMN LIST BELOW.
--
-- The first draft of this migration copied the column list out of
-- 20260728_security_and_integrity.sql, which is where this view was created.
-- That list is NINE COLUMNS SHORT of what production actually serves: the view
-- has been extended since by 20260728_gate_hours_overnight_fee.sql and
-- 20260729_listing_date_window.sql, and `create or replace view` does not merge
-- — it replaces. Applying that draft would have silently dropped gate_opens_at,
-- gate_closes_at, overnight_fee_pence, available_days, available_from,
-- available_until, extra_dates, blocked_dates and featured, taking gate hours,
-- booking windows and the overnight fee down with them. Nothing would have
-- errored; listings would just have started behaving as though no site had
-- gates.
--
-- The list below was read back off production with pg_get_viewdef, not
-- assembled from the migration history. If you add a column to this view again,
-- do the same — the migration files in this repo are not a complete record of
-- this database. See tests/db/known-drift.sql.
create or replace view public.listings_public
with (security_invoker = true) as
select
  id, title, description, address, lat, lng,
  space_type, host_type, spaces,
  price_per_hour, price_per_day, price_per_month,
  amenities, photos, availability,
  gate_opens_at, gate_closes_at, overnight_fee_pence,
  available_days, available_from, available_until,
  extra_dates, blocked_dates, featured,
  is_verified, verified_org_type,
  completed_bookings_count, average_rating, ratings_count,
  published_at, created_at,
  is_operator_site
from public.rental_listings
where status = 'active';

grant select on public.listings_public to anon, authenticated;
