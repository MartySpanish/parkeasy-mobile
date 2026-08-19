-- Hotspot moderation: restrictions required, private land refused, and a
-- one-tap way for a driver to say "this is wrong now".
--
-- NOT YET APPLIED to production.
--
-- Review-before-publish is unchanged. Every submission is still read by a human
-- before it goes on the map, and nothing here adds auto-publish — the accuracy
-- of these 745 spots is the whole product and a queue that empties itself is a
-- queue that stops meaning anything.

--------------------------------------------------------------------------------
-- 1. Restrictions are not optional
--------------------------------------------------------------------------------
-- "Free parking" with no enforcement hours is not a useful spot, it is a
-- ticket. Enforcement hours, permit zone, loading restrictions — whichever
-- applies has to be recorded, or a driver reads "free" and pays £90 for it.
--
-- Enforced at PUBLISH, not at submit. Somebody standing on a street typing what
-- they can see must not be blocked by a form; the founder reviewing it can ask.
-- So the constraint is conditional on status, which is exactly where the
-- decision is made.
alter table public.spot_submissions
  add column if not exists land_type text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'spot_submissions_land_type_valid') then
    alter table public.spot_submissions
      add constraint spot_submissions_land_type_valid
      check (land_type is null or land_type in ('public_road','council_car_park','private_land','unknown'));
  end if;

  if not exists (select 1 from pg_constraint where conname = 'spot_submissions_restriction_on_publish') then
    alter table public.spot_submissions
      add constraint spot_submissions_restriction_on_publish
      check (status <> 'approved' or length(coalesce(trim(restriction), '')) >= 3);
  end if;

  -- PRIVATE LAND IS REJECTED, NOT FLAGGED.
  --
  -- Telling a stranger to park on land somebody else owns is how a driver gets
  -- clamped, invoiced by a private enforcement firm, or towed — and how
  -- ParkEasy ends up named in the complaint. There is no version of this that
  -- is safe to publish with a warning attached, so it cannot reach 'approved'
  -- at all. A private car park that WANTS drivers becomes a listing, which is
  -- a different thing with an agreement behind it.
  if not exists (select 1 from pg_constraint where conname = 'spot_submissions_no_private_land') then
    alter table public.spot_submissions
      add constraint spot_submissions_no_private_land
      check (status <> 'approved' or coalesce(land_type, 'unknown') <> 'private_land');
  end if;
end $$;

comment on column public.spot_submissions.land_type is
  'Whose land the spot is on. private_land can never be approved — see '
  'spot_submissions_no_private_land. A private car park that wants drivers '
  'becomes a rental_listing instead, with an agreement behind it.';

--------------------------------------------------------------------------------
-- 2. "This is wrong now"
--------------------------------------------------------------------------------
-- A spot that was right in March is wrong in September: the council paints
-- lines, a barrier goes in, a residents' scheme starts. Nothing in the app let a
-- driver say so except an email nobody sends.
--
-- Two things happen on a report, and the second is the point: the spot is
-- queued for re-review, AND every other driver sees a "recently reported" flag
-- immediately. Waiting for a human before warning anyone means the next
-- fifty people drive to the same wrong place.
create table if not exists public.spot_reports (
  id           uuid primary key default gen_random_uuid(),
  -- Text, not a foreign key: the map mixes community submissions (uuid) with
  -- the curated seed data in src/*.js (integer ids), and a driver reporting a
  -- seeded spot is exactly as useful as one reporting a submitted spot.
  spot_key     text not null,
  reporter_id  uuid references auth.users(id) on delete set null,
  reason       text not null default 'wrong'
                 check (reason in ('wrong','gone','restricted','full_always','other')),
  note         text,
  created_at   timestamptz not null default now(),
  resolved_at  timestamptz,
  resolution   text
);

create index if not exists spot_reports_key_idx
  on public.spot_reports (spot_key, created_at desc);
create index if not exists spot_reports_open_idx
  on public.spot_reports (created_at desc) where resolved_at is null;

alter table public.spot_reports enable row level security;

-- Anyone signed in may report; anonymous drivers too, since the person who
-- notices a spot is wrong is usually not the person with an account.
drop policy if exists spot_reports_insert on public.spot_reports;
create policy spot_reports_insert on public.spot_reports
  for insert with check (reporter_id is null or reporter_id = auth.uid());

grant insert on public.spot_reports to anon, authenticated;
revoke select on public.spot_reports from anon, authenticated;

-- What the app reads instead: counts only, no reporter, no note. The flag next
-- to a spot is "two people said this is wrong this week", not a comment thread.
create or replace view public.spot_report_counts
with (security_invoker = false) as
select
  spot_key,
  count(*)                                          as reports,
  max(created_at)                                   as last_reported_at,
  count(*) filter (where created_at > now() - interval '30 days') as reports_30d
from public.spot_reports
where resolved_at is null
group by spot_key;

grant select on public.spot_report_counts to anon, authenticated;

comment on view public.spot_report_counts is
  'Open report counts per spot, for the "recently reported" flag. Counts only — '
  'never the reporter or the note, which are for the review queue.';

--------------------------------------------------------------------------------
-- 3. Clusters — the acquisition list, generated for free
--------------------------------------------------------------------------------
-- WHY THIS IS THE MOST VALUABLE VIEW IN THE FILE. A dense cluster of free spots
-- with no ParkEasy listing inside it is a place where drivers are already
-- circling and ParkEasy has nothing to sell them. That is not a statistic, it
-- is the list of who to go and sign, in priority order, and it falls out of
-- data that already exists.
--
-- Deliberately simple grid clustering rather than a real algorithm. ~500m at
-- this latitude is 0.0045° of latitude and 0.0077° of longitude; snapping to
-- that grid is one GROUP BY, is stable between runs, and is accurate enough to
-- point at a neighbourhood. DBSCAN would draw prettier boundaries around the
-- same streets.
create or replace view public.hotspot_clusters
with (security_invoker = false) as
with spots as (
  select id::text as spot_key, lat, lng, street, near
    from public.spot_submissions
   where status = 'approved' and lat is not null and lng is not null
),
gridded as (
  select
    round((lat / 0.0045)::numeric)::int as gy,
    round((lng / 0.0077)::numeric)::int as gx,
    *
  from spots
),
clustered as (
  select
    gy, gx,
    count(*)          as spot_count,
    avg(lat)          as lat,
    avg(lng)          as lng,
    -- The most common street name in the cluster, as a human-readable label.
    mode() within group (order by coalesce(street, near)) as area
  from gridded
  group by gy, gx
)
select
  c.gy, c.gx, c.area, c.spot_count, c.lat, c.lng,
  -- Bookable ParkEasy inventory within about a kilometre of the cluster centre.
  (
    select count(*) from public.rental_listings rl
     where rl.status = 'active' and rl.lat is not null
       and (rl.lat - c.lat) * (rl.lat - c.lat) * 12392214400.0
         + (rl.lng - c.lng) * (rl.lng - c.lng) * 4225000000.0 <= 1000.0 * 1000.0
  ) as listings_nearby
from clustered c;

grant select on public.hotspot_clusters to authenticated;

comment on view public.hotspot_clusters is
  'Approved community spots grouped onto a ~500m grid, with a count of bookable '
  'ParkEasy listings within ~1km. Sort by spot_count desc where listings_nearby '
  '= 0: that is demand with no supply signed, which is the host and operator '
  'acquisition list.';
