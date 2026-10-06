-- "Fourteen people looked for parking near you last month and found nothing."
--
-- The strongest fact ParkEasy owns is where Belfast wants to park and cannot,
-- and it is invisible to the people it would persuade: demand_points() is
-- service_role only and renders on an admin page no prospective host will ever
-- open. JustPark's host funnel opens with an earnings calculator built on
-- national averages — a guess. This one can be TRUE, because it is measured.
--
-- WHY A SECOND FUNCTION RATHER THAN OPENING THE FIRST. demand_points() returns
-- labels — the text a driver typed and the destination — and reads
-- parking_requests, which holds email addresses. None of that may reach an
-- anonymous caller. This returns counts and nothing else: no labels, no rows,
-- no coordinates finer than it was given.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- IT COUNTS DISTINCT SESSIONS, NOT EVENTS, AND THAT IS THE WHOLE CORRECTNESS
-- STORY. An earlier draft of this counted rows in app_events. Checked against
-- the live table before shipping, every single "cluster" in the database is ONE
-- session on ONE day:
--
--     lat/lng          events   sessions   days
--     54.73, -6.25        5         1        1     <- the biggest "cluster"
--     54.60, -5.90        3         1        1
--     ...all 16 locations: 1 session, 1 day
--
-- Counting events would have told a prospective host "5 people searched near
-- you and found nothing" when it was one person refreshing five times. That is
-- not a privacy problem, it is a false statement about demand, made to a
-- stranger about their own property — the same class of error as a car park
-- that claimed to be free. A session is the closest thing to a person this
-- schema has, so a session is the unit.
--
-- The same logic applies to parking_requests: one email, one person, however
-- many times they submit.
--
-- K-ANONYMITY, because a count of one is a person. In a thin postcode "1 person
-- searched near you" plus a date is close to identifying a single driver, and
-- the honest product answer agrees with the privacy one: one search is not
-- evidence of demand worth acting on. Below the floor this reports zero.
--
-- WHAT IS DELIBERATELY NOT COUNTED: gem_locked_view. An earlier draft included
-- it and was wrong twice — the event carries no coordinates at all, so the
-- count could only ever be zero, and a locked gem is not unmet demand anyway.
-- There IS a space there; it is behind the paywall. Counting it would overstate
-- the opportunity.
--
-- GRANTS: service_role only, for now. The founder dashboard is the only honest
-- consumer today, because with 31 events in the whole database the answer
-- everywhere is "not enough to say yet" — which is true, and useless in front
-- of a host. anon gets execute when there is something real to tell them.

begin;

--------------------------------------------------------------------------------
-- The floor, in one place
--------------------------------------------------------------------------------
-- Five distinct sessions is low enough that a real pocket of demand shows, and
-- high enough that no individual's search is inferable from the difference
-- between two queries a day apart.
create or replace function public.demand_min_cluster() returns integer
language sql immutable as $$ select 5 $$;

--------------------------------------------------------------------------------
-- Haversine, so both this and any future caller measure distance the same way
--------------------------------------------------------------------------------
-- In SQL rather than PostGIS, which this database does not have. Accurate to
-- well under the ~110m the source points are already rounded to, so more
-- precision would be false anyway.
create or replace function public.km_between(
  a_lat double precision, a_lng double precision,
  b_lat double precision, b_lng double precision
) returns double precision
language sql immutable
as $$
  select 2 * 6371 * asin(least(1, sqrt(
    sin(radians(b_lat - a_lat) / 2) ^ 2
    + cos(radians(a_lat)) * cos(radians(b_lat)) * sin(radians(b_lng - a_lng) / 2) ^ 2
  )));
$$;

--------------------------------------------------------------------------------
-- Unmet demand within a radius, as counts of distinct people
--------------------------------------------------------------------------------
create or replace function public.demand_near(
  p_lat       double precision,
  p_lng       double precision,
  p_radius_km double precision default 1.5,
  p_days      integer default 90
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
stable
as $$
declare
  v_days   integer := greatest(1, least(coalesce(p_days, 90), 365));
  -- Bounded so this cannot be walked outwards until it becomes a national
  -- total, or inwards until it isolates one street.
  v_radius double precision := greatest(0.5, least(coalesce(p_radius_km, 1.5), 5.0));
  v_floor  integer := public.demand_min_cluster();
  v_wait   integer := 0;
  v_search integer := 0;
  v_days_seen integer := 0;
  v_total  integer := 0;
begin
  if p_lat is null or p_lng is null
     or p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    return jsonb_build_object('ok', false, 'reason', 'bad_point');
  end if;

  -- People who asked to be told when a space opens near here. DISTINCT EMAIL:
  -- one person who submits three times is one person.
  select count(distinct lower(btrim(r.email))) into v_wait
    from public.parking_requests r
   where r.lat is not null and r.lng is not null
     and r.email is not null
     and r.created_at > now() - make_interval(days => v_days)
     and public.km_between(p_lat, p_lng, r.lat, r.lng) <= v_radius;

  -- Searches that came up empty. DISTINCT SESSION, and distinct days alongside
  -- it so a caller can tell a week of demand from one afternoon of refreshing.
  select count(distinct e.session_id), count(distinct e.created_at::date)
    into v_search, v_days_seen
    from public.app_events e
   where e.event_name = 'search_no_results'
     and e.created_at > now() - make_interval(days => v_days)
     and e.session_id is not null
     and (e.props ? 'lat') and (e.props ? 'lng')
     -- Guarded cast: props values are TEXT and one non-numeric row would
     -- otherwise error the whole function rather than skip that row.
     and (e.props ->> 'lat') ~ '^-?[0-9]+(\.[0-9]+)?$'
     and (e.props ->> 'lng') ~ '^-?[0-9]+(\.[0-9]+)?$'
     and public.km_between(p_lat, p_lng,
           (e.props ->> 'lat')::double precision,
           (e.props ->> 'lng')::double precision) <= v_radius;

  v_total := coalesce(v_wait, 0) + coalesce(v_search, 0);

  -- Below the floor, report nothing rather than a number that describes a
  -- person. The caller gets an honest "not enough to say yet".
  if v_total < v_floor then
    return jsonb_build_object(
      'ok', true, 'enough', false, 'total', 0,
      'radius_km', v_radius, 'days', v_days, 'min_cluster', v_floor);
  end if;

  return jsonb_build_object(
    'ok', true, 'enough', true,
    'total', v_total,
    'waiting', v_wait,            -- distinct people who asked to be told
    'searched', v_search,         -- distinct sessions that found nothing
    'days_seen', v_days_seen,     -- spread, so one afternoon cannot look like a month
    'radius_km', v_radius, 'days', v_days, 'min_cluster', v_floor);
end $$;

revoke all on function public.demand_near(double precision, double precision, double precision, integer) from public;
grant execute on function public.demand_near(double precision, double precision, double precision, integer) to service_role;
revoke all on function public.km_between(double precision, double precision, double precision, double precision) from public;
grant execute on function public.km_between(double precision, double precision, double precision, double precision) to authenticated, service_role;
revoke all on function public.demand_min_cluster() from public;
grant execute on function public.demand_min_cluster() to authenticated, service_role;

comment on function public.demand_near(double precision, double precision, double precision, integer) is
  'Unmet parking demand near a point, as COUNTS OF DISTINCT SESSIONS/EMAILS '
  'only — never events, never labels, never rows. demand_points() does labels '
  'and is service_role only. Suppressed below demand_min_cluster(), because a '
  'count of one is a person. service_role for now: not anon until the data is '
  'dense enough to say something true to a host.';

--------------------------------------------------------------------------------
-- While we are here: parking_requests holds EMAIL ADDRESSES and anon has
-- SELECT, UPDATE, DELETE and TRUNCATE grants on it.
--------------------------------------------------------------------------------
-- Today nothing leaks, because RLS is on and the only policy is an INSERT one,
-- so a select finds no policy and is denied. But the house pattern everywhere
-- else in this schema is "revoke all from anon, authenticated, then grant back
-- exactly what is needed" precisely so that a table is not one accidental
-- permissive policy away from handing out every lead ParkEasy has. The grants
-- were never narrowed when the table was created on 19 August.
revoke all on table public.parking_requests from anon, authenticated;
-- The capture form posts signed OUT, which is how most of the app is used, so
-- the insert must stay. Nothing else does.
grant insert on table public.parking_requests to anon, authenticated;

commit;
