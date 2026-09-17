-- Matchday alerts, and the two ways this channel gets switched off.
--
--   * Told twice. The sweep runs hourly and the alert window is two hours
--     wide, so without a claim every follower hears about every fixture twice.
--     Twice is how somebody turns notifications off, and then they hear nothing
--     about the one that mattered.
--   * Told about something they did not ask for. The list is followed venues,
--     not everybody within a mile of the ground, and a follow that leaks across
--     sessions is a push to a stranger.
--
-- And one that is quieter: a send list readable by anybody, which is a list of
-- who goes to which ground.
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
  ('bbbb2222-0000-0000-0000-000000000001', 'fan@test.local')
  on conflict do nothing;

--------------------------------------------------------------------------------
\echo ''
\echo '1. Neither table is readable, and neither is a write primitive'
--------------------------------------------------------------------------------
select assert((select relrowsecurity from pg_class where oid = 'public.event_alerts'::regclass),
  'row level security is on for event_alerts');
select assert((select relrowsecurity from pg_class where oid = 'public.event_alert_sends'::regclass),
  'and for event_alert_sends');

select assert(count(*) = 0, 'event_alerts has no policies — the functions are the whole surface')
  from pg_policies where tablename = 'event_alerts';
select assert(count(*) = 0, 'and no grants: the follower list is a send list')
  from information_schema.role_table_grants
 where table_name = 'event_alerts' and grantee in ('anon', 'authenticated');
select assert(count(*) = 0, 'the sends table is not readable either')
  from information_schema.role_table_grants
 where table_name = 'event_alert_sends' and grantee in ('anon', 'authenticated');

-- Claiming decides who gets pushed to. A driver who could call it could make
-- the sweep skip everybody, or push to a stranger.
select assert(not has_function_privilege('anon', 'public.claim_event_alerts(text,text,integer)', 'execute'),
  'anon cannot claim alerts');
select assert(not has_function_privilege('authenticated', 'public.claim_event_alerts(text,text,integer)', 'execute'),
  'a signed-in driver cannot claim alerts');
select assert(has_function_privilege('service_role', 'public.claim_event_alerts(text,text,integer)', 'execute'),
  'only the sweep can');

select assert(has_function_privilege('anon', 'public.set_event_alert(text,text,boolean)', 'execute'),
  'a guest can follow a venue — most followers will have no account');
select assert(has_function_privilege('anon', 'public.my_event_alerts(text)', 'execute'),
  'and can read back what this browser follows');

select assert(
  (select prosecdef from pg_proc where oid = v.fn::regprocedure)
  and (select proconfig::text like '%search_path=public, pg_temp%'
         from pg_proc where oid = v.fn::regprocedure),
  v.fn || ' is SECURITY DEFINER with a pinned search_path')
 from (values ('public.set_event_alert(text,text,boolean)'),
              ('public.claim_event_alerts(text,text,integer)'),
              ('public.my_event_alerts(text)')) v(fn);

--------------------------------------------------------------------------------
\echo ''
\echo '2. Following a venue'
--------------------------------------------------------------------------------
select assert(set_event_alert('sess-a', 'windsor'), 'a venue can be followed');
select assert((select count(*) from event_alerts where session_id = 'sess-a') = 1,
  'and it is recorded once');
select assert(set_event_alert('sess-a', 'windsor'), 'following again is not an error');
select assert((select count(*) from event_alerts where session_id = 'sess-a') = 1,
  'and does not add a second row');

select assert(set_event_alert('sess-a', ' windsor ') , 'whitespace round the key still matches');
select assert((select count(*) from event_alerts where session_id = 'sess-a') = 1,
  'so a stray space cannot create a duplicate nobody can unfollow');

select assert(set_event_alert('sess-a', 'solitude'), 'a second venue is a second follow');
select assert((select count(*) from event_alerts where session_id = 'sess-a') = 2, 'both kept');

-- Unfollowing removes the row. There is deliberately no "off" flag: a stored
-- "not interested" is a row the sweep has to remember to skip forever.
select assert(not set_event_alert('sess-a', 'solitude', false), 'unfollowing reports off');
select assert((select count(*) from event_alerts
                where session_id = 'sess-a' and venue = 'solitude') = 0,
  'and the row is gone rather than flagged');
select assert(not set_event_alert('sess-a', 'nothing-followed', false),
  'unfollowing something never followed is not an error');

-- A follow with no session cannot be delivered to anybody.
select assert(not set_event_alert(null, 'windsor'), 'a follow with no session is refused');
select assert(not set_event_alert('', 'windsor'), 'and so is a blank one');
select assert(not set_event_alert('sess-b', null), 'a follow of no venue is refused');
select assert(not set_event_alert('sess-b', '   '), 'and of a blank venue');
select assert(not set_event_alert('sess-b', repeat('x', 61)), 'an absurd venue key is refused');
select assert((select count(*) from event_alerts where session_id = 'sess-b') = 0,
  'none of those wrote a row');

-- The cap. A session following forty venues is not a person with forty teams.
do $$
declare i int;
begin
  for i in 1..25 loop
    perform public.set_event_alert('flooder', 'venue-' || i);
  end loop;
end $$;
select assert((select count(*) from event_alerts where session_id = 'flooder') = 20,
  'a session is capped at twenty venues');
-- And re-following one it already has is still allowed at the cap, or the
-- button silently stops working for the venue they care most about.
select assert(set_event_alert('flooder', 'venue-1'),
  'a session at the cap can still re-follow something it already follows');

--------------------------------------------------------------------------------
\echo ''
\echo '3. One session''s follows are its own'
--------------------------------------------------------------------------------
select assert(set_event_alert('sess-c', 'o2'), 'another browser follows something else');
select assert((select count(*) from my_event_alerts('sess-a')) = 1,
  'this browser sees only its own follows');
select assert((select count(*) from my_event_alerts('sess-a') v where v = 'windsor') = 1,
  'and sees the right one');
select assert((select count(*) from my_event_alerts('sess-c') v where v = 'o2') = 1,
  'and the other browser sees its own');
select assert((select count(*) from my_event_alerts(null)) = 0,
  'no session follows nothing, rather than everything');
select assert((select count(*) from my_event_alerts('')) = 0, 'and neither does a blank one');
select assert((select count(*) from my_event_alerts('never-seen')) = 0,
  'an unknown session follows nothing');

-- A signed-in follower is attributed from auth.uid(), never from an argument.
select set_config('request.jwt.claim.sub', 'bbbb2222-0000-0000-0000-000000000001', false);
select set_event_alert('sess-signed', 'affidea');
select assert((select user_id from event_alerts where session_id = 'sess-signed')
              = 'bbbb2222-0000-0000-0000-000000000001',
  'a follow is attributed from auth.uid()');
select assert(count(*) = 0, 'set_event_alert takes no user id argument at all')
  from information_schema.parameters
 where specific_name in (select specific_name from information_schema.routines
                          where routine_name = 'set_event_alert' and specific_schema = 'public')
   and data_type = 'uuid';
-- Signing out does not detach a follow already attributed.
select set_config('request.jwt.claim.sub', '', false);
select set_event_alert('sess-signed', 'affidea');
select assert((select user_id from event_alerts where session_id = 'sess-signed')
              = 'bbbb2222-0000-0000-0000-000000000001',
  'signing out does not detach a follow already made');

--------------------------------------------------------------------------------
\echo ''
\echo '4. Claimed before it is sent, and claimed once'
--------------------------------------------------------------------------------
-- A clean follower list, so every count below is the number it says. Without
-- this, sess-a from section 2 is still following Windsor Park and the first
-- claim returns four where the test says three — which is a test that has to be
-- read alongside two earlier sections to know what it means.
delete from public.event_alerts;
delete from public.event_alert_sends;

select set_event_alert('f1', 'windsor');
select set_event_alert('f2', 'windsor');
select set_event_alert('f3', 'windsor');
select set_event_alert('other', 'o2');

select assert((select count(*) from claim_event_alerts('ni-v-x', 'windsor')) = 3,
  'every follower of the venue is claimed');
select assert((select count(*) from event_alert_sends where event_id = 'ni-v-x') = 3,
  'and stamped before anything is pushed');

-- THE ONE THAT COSTS THE CHANNEL. The sweep runs hourly against a two-hour
-- window, so this happens on every single fixture.
select assert((select count(*) from claim_event_alerts('ni-v-x', 'windsor')) = 0,
  'a second sweep over the same event claims nobody');
select assert((select count(*) from event_alert_sends where event_id = 'ni-v-x') = 3,
  'and adds no second stamp');

-- Somebody who follows a different venue is not told.
select assert((select count(*) from event_alert_sends
                where event_id = 'ni-v-x' and session_id = 'other') = 0,
  'a follower of another venue is not pushed to');

-- SOMEBODY WHO FOLLOWS PART-WAY THROUGH THE WINDOW STILL GETS TOLD, and that
-- is the point rather than an oversight. The sweep only claims for events
-- inside the alert window, so "already sent" means sent to OTHER followers, not
-- that the news is stale — a driver who follows Windsor Park at 17:30 for a
-- 19:45 kick-off wants to hear about it, and the three who were told at 16:45
-- must not be told again.
--
-- The first version of this suite asserted the opposite, on the assumption that
-- an event already alerted on was finished with. It is not; the fixture has not
-- kicked off yet.
select set_event_alert('f4', 'windsor');
select assert((select count(*) from claim_event_alerts('ni-v-x', 'windsor')) = 1,
  'a new follower is claimed for an event still in its window');
select assert((select count(*) from event_alert_sends where event_id = 'ni-v-x') = 4,
  'and only they are stamped — the other three are not told twice');
select assert((select count(*) from claim_event_alerts('ni-v-x', 'windsor')) = 0,
  'and once they have been told, nobody is left to claim');
select assert((select count(*) from claim_event_alerts('ni-v-y', 'windsor')) = 4,
  'everybody is on the list for the next fixture');

-- And the claim is bounded, so one enormous venue cannot turn a sweep into a
-- timeout. The rest go out on the next run.
select assert((select count(*) from claim_event_alerts('ni-v-z', 'windsor', 2)) = 2,
  'the claim honours its limit');
select assert((select count(*) from claim_event_alerts('ni-v-z', 'windsor', 2)) = 2,
  'and the next run picks up where it left off');
select assert((select count(*) from event_alert_sends where event_id = 'ni-v-z') = 4,
  'until everybody has been told once');

select assert((select count(*) from claim_event_alerts(null, 'windsor')) = 0,
  'an event with no id claims nobody');
select assert((select count(*) from claim_event_alerts('ni-v-q', null)) = 0,
  'and neither does a venue with no key');
select assert((select count(*) from claim_event_alerts('ni-v-q', 'nobody-follows-this')) = 0,
  'a venue nobody follows claims nobody');
select assert((select count(*) from claim_event_alerts('ni-v-r', ' windsor ')) = 4,
  'a venue key with whitespace still finds its followers');

--------------------------------------------------------------------------------
\echo ''
\echo '5. Unfollowing actually stops the alerts'
--------------------------------------------------------------------------------
select set_event_alert('f1', 'windsor', false);
select assert((select count(*) from claim_event_alerts('ni-v-new', 'windsor')) = 3,
  'somebody who unfollowed is not claimed for the next fixture');
select assert((select count(*) from event_alert_sends
                where event_id = 'ni-v-new' and session_id = 'f1') = 0,
  'and is not stamped either');

\echo ''
