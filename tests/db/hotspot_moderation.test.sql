-- Moderation rules for community hotspots.
--
--   tests/db/run.sh supabase/migrations/20260720_spot_submissions.sql \
--                   supabase/migrations/20260728_public_approved_spots.sql \
--                   supabase/migrations/20260820_hotspot_moderation.sql \
--                   tests/db/hotspot_moderation.test.sql
\set ON_ERROR_STOP on
set client_min_messages = notice;

create or replace function assert(p_cond boolean, p_what text)
returns void language plpgsql as $$
begin
  if p_cond then raise notice '  PASS  %', p_what;
  else raise exception 'FAIL  %', p_what;
  end if;
end $$;

insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','ann@example.test');

--------------------------------------------------------------------------------
\echo ''
\echo '1. Restrictions are required to PUBLISH, not to submit'
--------------------------------------------------------------------------------
insert into public.spot_submissions (id, near, street, lat, lng, status)
values ('50000000-0000-0000-0000-000000000001','Beside the shops','Glen Road',54.58,-5.98,'new');
select assert(true, 'a submission with no restriction is accepted — the person on the street is not blocked by a form');

do $$ begin
  update public.spot_submissions set status = 'approved'
   where id = '50000000-0000-0000-0000-000000000001';
  raise exception 'FAIL  a spot was published with no restrictions recorded';
exception when check_violation then
  raise notice '  PASS  publishing without restrictions is refused';
end $$;

update public.spot_submissions
   set restriction = 'Free — no restrictions Mon-Sun', land_type = 'public_road', status = 'approved'
 where id = '50000000-0000-0000-0000-000000000001';
select assert(
  (select status from public.spot_submissions where id='50000000-0000-0000-0000-000000000001') = 'approved',
  'with restrictions recorded it publishes');

do $$ begin
  update public.spot_submissions set restriction = '  '
   where id = '50000000-0000-0000-0000-000000000001';
  raise exception 'FAIL  restrictions were blanked on a published spot';
exception when check_violation then
  raise notice '  PASS  restrictions cannot be blanked out after publishing';
end $$;

--------------------------------------------------------------------------------
\echo ''
\echo '2. Private land is refused, not flagged'
--------------------------------------------------------------------------------
insert into public.spot_submissions (id, near, street, lat, lng, restriction, land_type, status)
values ('50000000-0000-0000-0000-000000000002','Behind the retail park','Boucher Road',54.58,-5.95,
        'Free, 2 hours','private_land','new');

do $$ begin
  update public.spot_submissions set status = 'approved'
   where id = '50000000-0000-0000-0000-000000000002';
  raise exception 'FAIL  a private-land spot was published';
exception when check_violation then
  raise notice '  PASS  a private-land spot can never reach approved';
end $$;

select assert(
  (select status from public.spot_submissions where id='50000000-0000-0000-0000-000000000002') = 'new',
  'and it stays in the queue rather than disappearing');

do $$ begin
  insert into public.spot_submissions (near, lat, lng, land_type, status)
  values ('Nowhere', 54.5, -5.9, 'someone_elses_garden', 'new');
  raise exception 'FAIL  an unknown land_type was accepted';
exception when check_violation then
  raise notice '  PASS  land_type is a closed set';
end $$;

--------------------------------------------------------------------------------
\echo ''
\echo '3. "This is wrong now" reports'
--------------------------------------------------------------------------------
insert into public.spot_reports (spot_key, reporter_id, reason)
values ('50000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','restricted');
-- Seeded spots carry integer ids, and a driver reporting one of those is
-- exactly as useful as one reporting a submitted spot.
insert into public.spot_reports (spot_key, reason, note)
values ('71','gone','Barrier went in last month');
insert into public.spot_reports (spot_key, reason) values ('71','gone');

select assert(
  (select reports from public.spot_report_counts where spot_key = '71') = 2,
  'reports group by spot, seeded integer ids included');
select assert(
  (select reports_30d from public.spot_report_counts where spot_key = '71') = 2,
  'and the 30-day count is what the flag reads');

do $$ begin
  insert into public.spot_reports (spot_key, reason) values ('71','because I said so');
  raise exception 'FAIL  an arbitrary reason was accepted';
exception when check_violation then
  raise notice '  PASS  reason is a closed set';
end $$;

update public.spot_reports set resolved_at = now(), resolution = 'checked, still fine'
 where spot_key = '71';
select assert(
  (select count(*) from public.spot_report_counts where spot_key = '71') = 0,
  'a resolved report stops flagging the spot');

--------------------------------------------------------------------------------
\echo ''
\echo '4. Reports are counts to the app and never a comment thread'
--------------------------------------------------------------------------------
select assert(not has_table_privilege('anon','public.spot_reports','select'),
  'anon cannot read reports — notes and reporters are for the review queue');
select assert(not has_table_privilege('authenticated','public.spot_reports','select'),
  'nor can a signed-in driver');
select assert(has_table_privilege('anon','public.spot_reports','insert'),
  'but anyone can file one — the person who notices usually has no account');
select assert(has_table_privilege('anon','public.spot_report_counts','select'),
  'and everyone can see the counts');

--------------------------------------------------------------------------------
\echo ''
\echo '5. Clusters — the acquisition list'
--------------------------------------------------------------------------------
-- Eight spots tight around one point, and one on its own a long way off.
insert into public.spot_submissions (near, street, lat, lng, restriction, land_type, status)
select 'Spot ' || g, 'Ormeau Road', 54.5800 + g * 0.0002, -5.9200 + g * 0.0002,
       'Free after 6pm', 'public_road', 'approved'
  from generate_series(1, 8) g;
insert into public.spot_submissions (near, street, lat, lng, restriction, land_type, status)
values ('Lone spot','Portrush Harbour', 55.2060, -6.6560, 'Free', 'public_road', 'approved');

select assert(
  (select max(spot_count) from public.hotspot_clusters) >= 8,
  'nearby spots group into one cluster');
select assert(
  (select count(*) from public.hotspot_clusters) >= 2,
  'and a spot 90km away is its own cluster, not folded into it');

-- A listing inside the dense cluster.
--
-- THIS FIXTURE USED TO ASSERT SOMETHING THAT CANNOT HAPPEN. It inserted an
-- ACTIVE listing with no coordinates and checked it was not counted — which
-- only worked because the harness stubbed rental_listings with three columns.
-- The real table has publish_coords: a listing without lat/lng cannot be
-- active at all, so the case being tested does not exist in production.
--
-- Replaced with the one that does: a DRAFT nearby must not be counted, because
-- an unpublished car park is not supply anybody can use.
insert into public.rental_listings
  (id, title, address, lat, lng, status, instructions, photos, contact_phone,
   availability, price_per_day)
values
  ('bbbbbbbb-0000-0000-0000-000000000001','Ormeau car park','Ormeau Road',
   54.5810, -5.9210, 'draft',
   'Straight in the gate and park anywhere on the tarmac to your left.',
   array['a','b','c'], '02890000000', 'Always', 15.00);
select assert(
  (select listings_nearby from public.hotspot_clusters order by spot_count desc limit 1) = 0,
  'a DRAFT listing nearby is not counted — it is not supply anybody can use');

update public.rental_listings set status = 'active'
 where id = 'bbbbbbbb-0000-0000-0000-000000000001';
select assert(
  (select listings_nearby from public.hotspot_clusters order by spot_count desc limit 1) = 1,
  'a listing 150m away IS counted');

update public.rental_listings set lat = 54.6500, lng = -5.9210
 where id = 'bbbbbbbb-0000-0000-0000-000000000001';
select assert(
  (select listings_nearby from public.hotspot_clusters order by spot_count desc limit 1) = 0,
  'a listing 7km away is not — which is what makes the zero meaningful');

\echo ''
\echo 'ALL CHECKS PASSED'
