-- app_events ingest: the three things the old policy could not enforce.
--
-- The table shipped with "Anyone can log an event" — an unauthenticated,
-- unlimited, unvalidated INSERT. These checks exist because the replacement is
-- only worth anything if all three guards hold under the roles a real caller
-- actually uses, so every assertion below runs as `anon` or `authenticated`,
-- never as the superuser that applied the migration.
\set ON_ERROR_STOP on
set client_min_messages = notice;

create or replace function assert(p_cond boolean, p_what text)
returns void language plpgsql as $$
begin
  if p_cond then raise notice '  PASS  %', p_what;
  else raise exception 'FAIL  %', p_what;
  end if;
end $$;

\echo ''
\echo '1. The old door is shut'

select assert(not exists (
  select 1 from pg_policy p join pg_class c on c.oid = p.polrelid
   where c.relname = 'app_events' and p.polname = 'Anyone can log an event'),
  'the open INSERT policy is gone');

select assert((select relrowsecurity from pg_class where relname = 'app_events'),
  'RLS is on for app_events');

select assert((select count(*) from pg_policy p join pg_class c on c.oid = p.polrelid
                where c.relname = 'app_events') = 0,
  'no permissive policy was added back — the function is the whole surface');

grant usage on schema public to anon, authenticated;

select assert(not has_table_privilege('anon', 'public.app_events', 'insert'),
  'anon cannot insert into app_events directly');
select assert(not has_table_privilege('anon', 'public.app_events', 'select'),
  'anon cannot read app_events');
select assert(not has_table_privilege('authenticated', 'public.app_events', 'select'),
  'a signed-in user cannot read other people''s events');

--------------------------------------------------------------------------------
\echo ''
\echo '2. The allowlist'
--------------------------------------------------------------------------------
set role anon;
select set_config('request.jwt.claim.sub', '', false);

select assert(public.log_app_event('search', 'aaaaaaaa-0000-0000-0000-000000000001'),
  'a known event name is accepted');
select assert(not public.log_app_event('drop_table', 'aaaaaaaa-0000-0000-0000-000000000001'),
  'an unknown event name is refused');
select assert(not public.log_app_event(null, 'aaaaaaaa-0000-0000-0000-000000000001'),
  'a null event name is refused');
select assert(not public.log_app_event('search', null),
  'an event with no session is refused — it could not be rate-limited');

reset role;
select assert((select count(*) from public.app_events) = 1,
  'exactly one row landed: the refusals wrote nothing');
select assert((select event_name from public.app_events) = 'search',
  'and it is the allowed one');

--------------------------------------------------------------------------------
\echo ''
\echo '3. Rate limit: 60 a minute, per session'
--------------------------------------------------------------------------------
-- 59 more on the same session takes it to the cap exactly.
set role anon;
do $$
begin
  for i in 1..59 loop
    perform public.log_app_event('search', 'aaaaaaaa-0000-0000-0000-000000000001');
  end loop;
end $$;

select assert(not public.log_app_event('search', 'aaaaaaaa-0000-0000-0000-000000000001'),
  'the 61st event in a minute is refused');

-- A different session is unaffected: the limit is per session, not global.
select assert(public.log_app_event('search', 'aaaaaaaa-0000-0000-0000-000000000002'),
  'a different session is not caught by another session''s limit');

reset role;
select assert((select count(*) from public.app_events where session_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 60,
  'the capped session stopped at exactly 60 rows');

-- Older events do not count against the window.
update public.app_events set created_at = now() - interval '2 minutes'
 where session_id = 'aaaaaaaa-0000-0000-0000-000000000001';
set role anon;
select assert(public.log_app_event('search', 'aaaaaaaa-0000-0000-0000-000000000001'),
  'once the minute has passed the same session can log again');
reset role;

--------------------------------------------------------------------------------
\echo ''
\echo '4. props is shaped, not trusted'
--------------------------------------------------------------------------------
delete from public.app_events;
set role anon;

-- A 500-character string comes back truncated to 200.
select public.log_app_event('search_no_results', 'bbbbbbbb-0000-0000-0000-000000000001',
  jsonb_build_object('query', repeat('x', 500)));
reset role;
select assert(length((select props ->> 'query' from public.app_events)) = 200,
  'a long string value is truncated to 200 characters');

delete from public.app_events;
set role anon;
-- 40 keys come back as 20.
select public.log_app_event('search', 'bbbbbbbb-0000-0000-0000-000000000002',
  (select jsonb_object_agg('k' || i, i) from generate_series(1, 40) i));
reset role;
select assert((select count(*) from jsonb_each((select props from public.app_events))) = 20,
  'props is capped at 20 keys');

delete from public.app_events;
set role anon;
-- A non-object props becomes {} rather than blowing up the insert.
select assert(public.log_app_event('search', 'bbbbbbbb-0000-0000-0000-000000000003', '"a string"'::jsonb),
  'a non-object props does not break the call');
reset role;
select assert((select props from public.app_events) = '{}'::jsonb,
  'a non-object props is stored as an empty object');

-- path and town are caller-supplied strings too, and they are columns rather
-- than props, so the props capping above never touches them. A 4 KB path is a
-- cheap way to bloat the table one legitimate-looking event at a time.
delete from public.app_events;
set role anon;
select public.log_app_event('search', 'bbbbbbbb-0000-0000-0000-000000000004',
  '{}'::jsonb, repeat('p', 1000), repeat('t', 1000));
reset role;
select assert(length((select path from public.app_events)) = 300,
  'path is truncated to 300 characters');
select assert(length((select town from public.app_events)) = 120,
  'town is truncated to 120 characters');

--------------------------------------------------------------------------------
\echo ''
\echo '5. user_id comes from the session, never from the caller'
--------------------------------------------------------------------------------
delete from public.app_events;
insert into auth.users (id, email) values
  ('cccccccc-0000-0000-0000-000000000001', 'real@example.test')
  on conflict do nothing;

set role authenticated;
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000001', false);
select public.log_app_event('booking_start', 'dddddddd-0000-0000-0000-000000000001');
reset role;
select assert((select user_id from public.app_events) = 'cccccccc-0000-0000-0000-000000000001',
  'a signed-in caller''s event is attributed to them');

-- There is no parameter through which a caller could claim to be someone else:
-- the function takes no user_id at all.
select assert(pg_get_function_identity_arguments(
    (select oid from pg_proc where proname = 'log_app_event')) not like '%user%',
  'the function exposes no user_id parameter to spoof');

delete from public.app_events;
set role anon;
select set_config('request.jwt.claim.sub', '', false);
select public.log_app_event('search', 'dddddddd-0000-0000-0000-000000000002');
reset role;
select assert((select user_id from public.app_events) is null,
  'an anonymous event has a null user_id, not a fabricated one');

--------------------------------------------------------------------------------
\echo ''
\echo '6. The summary is service_role only, and counts sessions not taps'
--------------------------------------------------------------------------------
delete from public.app_events;

select assert(not has_function_privilege('anon', 'public.app_events_summary(integer)', 'execute'),
  'anon cannot run the summary — it reads every user''s events');
select assert(not has_function_privilege('authenticated', 'public.app_events_summary(integer)', 'execute'),
  'a signed-in user cannot run the summary either');
select assert(has_function_privilege('service_role', 'public.app_events_summary(integer)', 'execute'),
  'service_role can run the summary');

-- One session tapping three locked gems is ONE person who wanted them. If this
-- counted taps the paywall would look like it converts a third as well as it
-- does, which is the kind of error that gets a working feature deleted.
set role anon;
select public.log_app_event('gem_locked_view', 'eeeeeeee-0000-0000-0000-000000000001');
select public.log_app_event('gem_locked_view', 'eeeeeeee-0000-0000-0000-000000000001');
select public.log_app_event('gem_locked_view', 'eeeeeeee-0000-0000-0000-000000000001');
select public.log_app_event('gem_locked_view', 'eeeeeeee-0000-0000-0000-000000000002');
select public.log_app_event('premium_paywall_view', 'eeeeeeee-0000-0000-0000-000000000001');
select public.log_app_event('premium_paid', 'eeeeeeee-0000-0000-0000-000000000001');
reset role;

select assert((public.app_events_summary(30) -> 'premium_funnel' ->> 'gem_locked_view')::int = 2,
  'the funnel counts 2 sessions, not 4 taps');
select assert((public.app_events_summary(30) -> 'premium_funnel' ->> 'premium_paid')::int = 1,
  'and one of them paid');

-- The supply list, which is the one output meant to be acted on.
delete from public.app_events;
set role anon;
-- Bangor goes in FIRST and the commonest search second, deliberately. With the
-- rarer one inserted first, "sorted by frequency" and "in the order they
-- arrived" give different answers — so the assertion below can tell them
-- apart. Seeded the other way round the two orderings agree by luck and the
-- check passes even when the sort has been removed.
select public.log_app_event('search_no_results', 'ffffffff-0000-0000-0000-000000000003',
  jsonb_build_object('query', 'Bangor Marina'), null, 'Bangor');
select public.log_app_event('search_no_results', 'ffffffff-0000-0000-0000-000000000001',
  jsonb_build_object('query', 'Royal Victoria Hospital'), null, 'Belfast');
select public.log_app_event('search_no_results', 'ffffffff-0000-0000-0000-000000000002',
  jsonb_build_object('query', 'Royal Victoria Hospital'), null, 'Belfast');
reset role;

select assert((public.app_events_summary(30) -> 'no_results' -> 0 ->> 'query') = 'Royal Victoria Hospital',
  'the commonest unmet search sorts first');
select assert((public.app_events_summary(30) -> 'no_results' -> 0 ->> 'n')::int = 2,
  'and carries its count');
select assert(jsonb_array_length(public.app_events_summary(30) -> 'no_results') = 2,
  'both distinct unmet searches are listed');

-- The window is honoured: an event outside it is not in the summary.
update public.app_events set created_at = now() - interval '40 days';
select assert(jsonb_array_length(public.app_events_summary(30) -> 'no_results') = 0,
  'events older than the window are excluded');
select assert(jsonb_array_length(public.app_events_summary(60) -> 'no_results') = 2,
  'and included again when the window is widened');

\echo ''
\echo 'app_events: all checks passed'
