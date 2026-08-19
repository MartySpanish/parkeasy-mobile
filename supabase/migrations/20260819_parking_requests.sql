-- "Tell me when there's parking to book near here." APPLIED 19 Aug 2026.
--
-- WHY. ParkEasy has ONE active bookable site — a GAA club car park in west
-- Belfast. Everywhere else, a driver who wants to book finds nothing, sees an
-- empty space where an answer should be, and leaves. That demand is real and
-- it currently evaporates.
--
-- Capturing it does two jobs at once. The driver gets told when something
-- opens near them, and Marty gets the one sentence that makes a treasurer say
-- yes: "eleven people looked for parking near your club last month." Right now
-- that sentence cannot be said, because nobody is counting.
--
-- WHAT IS STORED, AND WHAT IS NOT. An email, where they were looking, and the
-- date they wanted. Not their location — the coordinates are of the PLACE THEY
-- SEARCHED FOR, which they typed, not where their phone is. That distinction
-- is the whole reason this is safe to keep.
create table if not exists public.parking_requests (
  id           uuid primary key default gen_random_uuid(),
  email        text not null,
  -- What they typed, e.g. "Botanic Gardens" or "BT7 1JW".
  destination  text not null,
  -- The searched place's coordinates, so requests can be clustered by area and
  -- matched against a club's postcode. Never the driver's own position.
  lat          double precision,
  lng          double precision,
  -- The day they wanted it, when they told us. Null is fine — plenty of people
  -- are asking in general rather than for a fixture.
  wanted_on    date,
  -- Set once they have been told a space opened, so nobody is emailed twice.
  notified_at  timestamptz,
  created_at   timestamptz not null default now()
);

create index if not exists parking_requests_created_idx on public.parking_requests (created_at desc);
create index if not exists parking_requests_geo_idx on public.parking_requests (lat, lng);

-- RLS on, and no read policy: these are people's email addresses. The insert
-- policy exists because the whole app works signed out and a request has to be
-- possible without an account. Reading is service-role only, through the
-- admin dashboard.
alter table public.parking_requests enable row level security;

drop policy if exists "parking_requests_public_insert" on public.parking_requests;
create policy "parking_requests_public_insert" on public.parking_requests
  for insert to anon, authenticated with check (true);

-- The view Marty actually wants: demand grouped by where people looked, so a
-- club can be shown its own number. Rounded to ~1km so "Botanic Gardens" and
-- "Botanic Avenue" land in the same bucket instead of looking like two markets.
--
-- security_invoker = true is NOT optional here. A Postgres 15+ view runs as its
-- OWNER by default, which means it reads straight through the RLS above and
-- hands the aggregate to whoever can select the view. That would break the
-- promise made four lines up. With security_invoker the view runs as the
-- CALLER, so anon hits the same no-read policy and gets nothing; service_role
-- reads it fine, because service_role bypasses RLS anyway. The revoke below is
-- the belt to that pair of braces — Supabase grants anon SELECT on new objects
-- in public by default, and this takes it straight back off.
create or replace view public.parking_demand with (security_invoker = true) as
select
  round(lat::numeric, 2) as lat_bucket,
  round(lng::numeric, 2) as lng_bucket,
  count(*)::int          as requests,
  min(created_at)        as first_asked,
  max(created_at)        as last_asked,
  (array_agg(destination order by created_at desc))[1:5] as recent_destinations
from public.parking_requests
where lat is not null and lng is not null
group by 1, 2
order by requests desc;

revoke all on public.parking_demand from anon, authenticated;

-- ── WHAT THIS COLLIDED WITH, 19 Aug ───────────────────────────────────────
-- This did not apply cleanly, and it was not the Supabase outage that stopped
-- it. public.parking_demand already existed as a TABLE — a second, untracked
-- attempt at this same feature, with columns postcode/near_text/occasion/
-- max_price_pence/source. Postgres will not replace a table with a view, so
-- the last statement here failed every time regardless of connectivity.
--
-- That table had no writer: the app inserts into parking_requests and always
-- has. It held 0 rows. It was dropped, and this view now owns the name.
-- See 20260819_parking_requests_repoint.sql. Against the live database that
-- one had to run FIRST, because founder_dashboard depended on the table and
-- Postgres refuses to drop out from under a view. It is named to sort SECOND
-- here, because a replay onto an empty database needs parking_requests to
-- exist before anything can point at it. Same two files, opposite orders, and
-- both are correct for the situation they run in.
