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
create or replace view public.parking_demand as
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
