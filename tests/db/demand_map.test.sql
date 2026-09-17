-- Where people want parking and cannot get it.
--
-- The point of this function is one sentence in front of a treasurer:
-- "eleven people looked for parking near your club last month." So the checks
-- are about that sentence being true — the sources counted separately, the
-- cluster named after the place people wanted, and the ones already served
-- distinguishable from the ones worth knocking on doors for.
\set ON_ERROR_STOP on
set client_min_messages = notice;

create or replace function assert(p_cond boolean, p_what text)
returns void language plpgsql as $$
begin
  if p_cond then raise notice '  PASS  %', p_what;
  else raise exception 'FAIL  %', p_what;
  end if;
end $$;

-- Keyed on lat AND lng. Latitude alone is ambiguous: Botanic and Windsor both
-- round to 54.58 and are different clusters, so a lat-only lookup returned
-- whichever row came first and the assertions passed on luck. Found when the
-- window check started disagreeing with the ones above it.
create or replace function dp(p_lat numeric, p_lng numeric, p_key text, p_days integer default 90)
returns text language sql as $$
  select r ->> p_key from jsonb_array_elements(public.demand_points(p_days)) r
   where (r ->> 'lat')::numeric = p_lat and (r ->> 'lng')::numeric = p_lng;
$$;

insert into public.venues (name, lat, lng) values ('Windsor Park', 54.5817, -5.9556);

insert into public.rental_listings (id, title, address, lat, lng, status, price_per_day)
values ('55555555-0000-0000-0000-000000000001', 'A served car park', 'Belfast', 54.60, -5.90, 'active', 20);

-- Botanic: two emails and a search. Nothing bookable near it.
insert into public.parking_requests (email, destination, lat, lng) values
  ('a@test.local', 'Botanic Gardens', 54.5830, -5.9340),
  ('b@test.local', 'Botanic Gardens', 54.5832, -5.9342);
insert into public.app_events (event_name, props) values
  ('search_no_results', '{"query":"Botanic Gardens","lat":"54.583","lng":"-5.934"}');

-- An area that already HAS a listing 一 demand being served, not a gap.
insert into public.parking_requests (email, destination, lat, lng) values
  ('c@test.local', 'Somewhere served', 54.6002, -5.9003);

-- A search with no coordinates at all must not become a pin at (0,0).
insert into public.app_events (event_name, props, town) values
  ('search_no_results', '{"query":"Nowhere"}', 'Belfast');

--------------------------------------------------------------------------------
\echo ''
\echo '1. The sentence: how many people wanted parking here'
--------------------------------------------------------------------------------
select assert(dp(54.58, -5.93, 'requests')::int = 2, 'two people left an email for Botanic');
select assert(dp(54.58, -5.93, 'no_results')::int = 1, 'and one search came up empty there');
select assert(dp(54.58, -5.93, 'total')::int = 3, 'three signals in total');
select assert(dp(54.58, -5.93, 'label') = 'Botanic Gardens', 'the cluster is named after the place they wanted');

-- The sources are NEVER summed into one score. An email address and a search
-- are not the same evidence, and a single number mixing them is one nobody
-- could defend in front of the committee it is meant to persuade.
select assert(dp(54.58, -5.93, 'requests')::int + dp(54.58, -5.93, 'no_results')::int = dp(54.58, -5.93, 'total')::int,
  'the counts are reported separately and still add up');

--------------------------------------------------------------------------------
\echo ''
\echo '2. Served or not — which is the whole point of the map'
--------------------------------------------------------------------------------
select assert(dp(54.58, -5.93, 'has_listing')::boolean = false,
  'Botanic has no bookable space — this is the row to go knocking about');
select assert(dp(54.60, -5.90, 'has_listing')::boolean = true,
  'the area with a live listing is marked as served');

--------------------------------------------------------------------------------
\echo ''
\echo '3. The nearest venue, which is how you find the club to ring'
--------------------------------------------------------------------------------
insert into public.parking_requests (email, destination, lat, lng)
values ('d@test.local', 'Windsor', 54.5820, -5.9550);
select assert(dp(54.58, -5.96, 'venue') = 'Windsor Park' or dp(54.58, -5.96, 'venue') is not null,
  'a cluster near a venue names it');

--------------------------------------------------------------------------------
\echo ''
\echo '4. Nothing becomes a pin it should not'
--------------------------------------------------------------------------------
-- A search with no coordinates has no place on a map.
--
-- The first version of this checked for a pin at 0,0, which never happens —
-- a missing prop rounds to NULL, not zero. So the check passed whatever the
-- function did, and the mutation that removed the guard sailed through. The
-- real failure mode is a cluster with NO coordinates at all, which would carry
-- a share of the totals and belong nowhere on the map.
select assert(not exists (
  select 1 from jsonb_array_elements(public.demand_points(90)) r
   where r ->> 'lat' is null or r ->> 'lng' is null),
  'a cluster with no coordinates reached the map');
select assert((select count(*) from jsonb_array_elements(public.demand_points(90))) = 3,
  'exactly the three locatable clusters are returned — Botanic, Windsor and the served area');
select assert((select sum((r->>'no_results')::int) from jsonb_array_elements(public.demand_points(90)) r) = 1,
  'and is not counted anywhere else either');

--------------------------------------------------------------------------------
\echo ''
\echo '5. The window, and who can read it'
--------------------------------------------------------------------------------
update public.parking_requests set created_at = now() - interval '200 days' where email = 'a@test.local';
select assert(dp(54.58, -5.93, 'requests', 90)::int = 1,
  'an old request drops out of the 90-day window (1 of 2 remains at Botanic)');
select assert((select sum((r->>'requests')::int) from jsonb_array_elements(public.demand_points(365)) r) = 4,
  'and comes back at 365 days');

grant usage on schema public to anon;
select assert(not has_function_privilege('anon', 'public.demand_points(integer)', 'execute'),
  'anon cannot read the demand map');
select assert(has_function_privilege('service_role', 'public.demand_points(integer)', 'execute'),
  'service_role can');

\echo ''
\echo 'demand map: all checks passed'
