-- A reminder that has to be true when it arrives.
--
-- The whole point of storing a parking timer server-side is that the phone is
-- asleep when it matters. That makes three things load-bearing, and none of
-- them is visible from the UI:
--
--   1. The bounds. The sweep runs every five minutes, so a timer due in three
--      is a promise that cannot be kept.
--   2. One row per session. A driver who changes their mind twice must not get
--      three notifications.
--   3. Cancelled and sent timers stay out of the sweep. Being notified about
--      parking you already left is worse than not being notified.
\set ON_ERROR_STOP on
set client_min_messages = notice;

create or replace function assert(p_cond boolean, p_what text)
returns void language plpgsql as $$
begin
  if p_cond then raise notice '  PASS  %', p_what;
  else raise exception 'FAIL  %', p_what;
  end if;
end $$;

-- The sweep's own query, written once here so every check below tests the
-- thing the cron actually runs rather than a paraphrase of it.
create or replace function due_now() returns setof public.parking_timers
language sql as $$
  select * from public.parking_timers
   where remind_at <= now() and sent_at is null and cancelled_at is null;
$$;

-- Owed a notification, whether or not the clock has reached it yet. The
-- distinction matters: a timer can be perfectly live and simply not due, and
-- more than one check below got that wrong before it was written down.
create or replace function live_now() returns setof public.parking_timers
language sql as $$
  select * from public.parking_timers
   where sent_at is null and cancelled_at is null;
$$;

--------------------------------------------------------------------------------
\echo ''
\echo '1. The table is not a write primitive'
--------------------------------------------------------------------------------
select assert(relrowsecurity, 'row level security is on')
  from pg_class where oid = 'public.parking_timers'::regclass;
select assert(count(*) = 0, 'no policies — the functions are the whole surface')
  from pg_policies where tablename = 'parking_timers';
select assert(count(*) = 0, 'anon and authenticated hold no table privilege')
  from information_schema.role_table_grants
 where table_name = 'parking_timers' and grantee in ('anon', 'authenticated');
select assert(
  has_function_privilege('anon', 'public.set_parking_timer(uuid,timestamptz,integer,text,double precision,double precision)', 'execute'),
  'a guest can set a timer — no account needed to be reminded');
select assert(
  has_function_privilege('anon', 'public.cancel_parking_timer(uuid)', 'execute'),
  'a guest can cancel one');
select assert(
  (select prosecdef from pg_proc where oid = 'public.set_parking_timer(uuid,timestamptz,integer,text,double precision,double precision)'::regprocedure),
  'set_parking_timer is SECURITY DEFINER');
select assert(
  (select proconfig::text like '%search_path=public, pg_temp%' from pg_proc
    where oid = 'public.set_parking_timer(uuid,timestamptz,integer,text,double precision,double precision)'::regprocedure),
  'set_parking_timer pins its search_path');

--------------------------------------------------------------------------------
\echo ''
\echo '2. Bounds: a promise the sweep can keep'
--------------------------------------------------------------------------------
select assert(public.set_parking_timer(null, now() + interval '2 hours') is false,
              'a null session is refused');
select assert(public.set_parking_timer('11111111-0000-0000-0000-000000000001', null) is false,
              'a null due time is refused');
select assert(public.set_parking_timer('11111111-0000-0000-0000-000000000001', now() + interval '3 minutes') is false,
              'three minutes away is refused — the sweep runs every five');
select assert(public.set_parking_timer('11111111-0000-0000-0000-000000000001', now() - interval '1 hour') is false,
              'a time in the past is refused');
select assert(public.set_parking_timer('11111111-0000-0000-0000-000000000001', now() + interval '25 hours') is false,
              'past a day it is storage, not parking');
select assert(count(*) = 0, 'nothing refused was stored') from public.parking_timers;

select assert(public.set_parking_timer('11111111-0000-0000-0000-000000000001', now() + interval '11 minutes') is true,
              'eleven minutes away is allowed');
select assert(public.set_parking_timer('11111111-0000-0000-0000-000000000002', now() + interval '23 hours') is true,
              'a long stay inside the day is allowed');

--------------------------------------------------------------------------------
\echo ''
\echo '3. The warning is clamped, never dropped'
--------------------------------------------------------------------------------
-- A 15-minute warning on a 12-minute stay would want to fire before the timer
-- was set. The driver still asked to be reminded, so it is pulled in rather
-- than refused.
select assert(public.set_parking_timer('11111111-0000-0000-0000-00000000000c', now() + interval '12 minutes', 15) is true,
              'a warning longer than the stay does not refuse the timer');
-- What the clamp is FOR: a 15-minute warning on a 12-minute stay would want to
-- fire three minutes ago. The reminder must land in the future — a remind_at in
-- the past is a notification sent the instant the driver walks away, telling
-- them their parking is nearly up when they have twelve minutes.
select assert(remind_at > now(), 'the clamp scheduled the reminder in the past')
  from public.parking_timers where session_id = '11111111-0000-0000-0000-00000000000c';
select assert(remind_at <= due_at, 'the clamped reminder sits at or before the due time')
  from public.parking_timers where session_id = '11111111-0000-0000-0000-00000000000c';
select assert(count(*) = 0, 'and it is not swept before it is due')
  from due_now() where session_id = '11111111-0000-0000-0000-00000000000c';

select assert(public.set_parking_timer('11111111-0000-0000-0000-00000000000d', now() + interval '2 hours', 30) is true,
              'a two-hour stay with a 30 minute warning is stored');
select assert(remind_at between now() + interval '89 minutes' and now() + interval '91 minutes',
              'the warning is 30 minutes before the due time')
  from public.parking_timers where session_id = '11111111-0000-0000-0000-00000000000d';
select assert(count(*) = 0, 'a warning still an hour away is not swept yet')
  from due_now() where session_id = '11111111-0000-0000-0000-00000000000d';

-- A zero warning means "tell me when it runs out", not "never".
select assert(public.set_parking_timer('11111111-0000-0000-0000-00000000000e', now() + interval '30 minutes', 0) is true,
              'a zero warning is allowed');
select assert(remind_at = due_at, 'a zero warning fires exactly at the due time')
  from public.parking_timers where session_id = '11111111-0000-0000-0000-00000000000e';

--------------------------------------------------------------------------------
\echo ''
\echo '4. One timer per session — changing your mind does not stack'
--------------------------------------------------------------------------------
select public.set_parking_timer('22222222-0000-0000-0000-000000000001', now() + interval '1 hour', 15, 'Dublin Road', 54.59, -5.93);
select public.set_parking_timer('22222222-0000-0000-0000-000000000001', now() + interval '3 hours', 20, 'Dublin Road on-street', 54.6, -5.94);
select assert(count(*) = 1, 'two timers for one session is one row')
  from public.parking_timers where session_id = '22222222-0000-0000-0000-000000000001';
select assert(label = 'Dublin Road on-street' and lat = 54.6
              and due_at between now() + interval '179 minutes' and now() + interval '181 minutes',
              'the replacement won, not the original')
  from public.parking_timers where session_id = '22222222-0000-0000-0000-000000000001';

-- A replaced timer is a new promise: a sent or cancelled row owes a
-- notification again, or a driver who re-parks in the same session hears
-- nothing at all.
update public.parking_timers set sent_at = now(), cancelled_at = now()
 where session_id = '22222222-0000-0000-0000-000000000001';
select public.set_parking_timer('22222222-0000-0000-0000-000000000001', now() + interval '11 minutes', 0);
select assert(sent_at is null and cancelled_at is null,
              'replacing a spent timer clears both stamps')
  from public.parking_timers where session_id = '22222222-0000-0000-0000-000000000001';
select assert(count(*) = 1, 'and the sweep owes it a notification again')
  from live_now() where session_id = '22222222-0000-0000-0000-000000000001';

--------------------------------------------------------------------------------
\echo ''
\echo '5. Spent and cancelled timers stay out of the sweep'
--------------------------------------------------------------------------------
-- TIME TRAVEL, and why it is the only way to test this. set_parking_timer
-- refuses anything less than ten minutes out, so no legitimate call can
-- produce a row that is due the moment it is written. Winding remind_at back
-- is how the clock reaching the timer is simulated; the alternative is a test
-- that waits ten minutes.
select public.set_parking_timer('33333333-0000-0000-0000-000000000001', now() + interval '11 minutes', 0);
update public.parking_timers set remind_at = now() - interval '1 minute'
 where session_id = '33333333-0000-0000-0000-000000000001';
select assert(count(*) = 1, 'due before it is sent') from due_now()
 where session_id = '33333333-0000-0000-0000-000000000001';
update public.parking_timers set sent_at = now()
 where session_id = '33333333-0000-0000-0000-000000000001';
select assert(count(*) = 0, 'a sent reminder is never sent twice') from due_now()
 where session_id = '33333333-0000-0000-0000-000000000001';

select public.set_parking_timer('33333333-0000-0000-0000-000000000002', now() + interval '11 minutes', 0);
update public.parking_timers set remind_at = now() - interval '1 minute'
 where session_id = '33333333-0000-0000-0000-000000000002';
select assert(count(*) = 1, 'due before it is cancelled') from due_now()
 where session_id = '33333333-0000-0000-0000-000000000002';
select assert(public.cancel_parking_timer('33333333-0000-0000-0000-000000000002') is true,
              'ending the session cancels the reminder');
select assert(count(*) = 0, 'a driver who has left is not told about parking they left')
  from due_now() where session_id = '33333333-0000-0000-0000-000000000002';
select assert(count(*) = 1, 'the row is kept, so the sweep has something to exclude')
  from public.parking_timers where session_id = '33333333-0000-0000-0000-000000000002';

select assert(public.cancel_parking_timer('33333333-0000-0000-0000-000000000002') is false,
              'cancelling twice reports nothing cancelled');
select assert(public.cancel_parking_timer(null) is false, 'a null session cancels nothing');
select assert(public.cancel_parking_timer('99999999-0000-0000-0000-000000000009') is false,
              'cancelling a timer that was never set reports nothing');
-- A reminder already sent cannot be un-sent.
select assert(public.cancel_parking_timer('33333333-0000-0000-0000-000000000001') is false,
              'cancelling after the push has gone reports nothing to cancel');

--------------------------------------------------------------------------------
\echo ''
\echo '6. remind_at can never sit after due_at'
--------------------------------------------------------------------------------
do $$
begin
  begin
    insert into public.parking_timers (session_id, due_at, remind_at)
    values ('44444444-0000-0000-0000-000000000001', now() + interval '1 hour', now() + interval '2 hours');
    raise exception 'FAIL  a reminder was stored for after the parking ran out';
  exception when check_violation then
    raise notice '  PASS  a reminder after the due time is refused by the database';
  end;
end $$;

--------------------------------------------------------------------------------
\echo ''
\echo '7. The send list is service-role only'
--------------------------------------------------------------------------------
set role authenticated;
do $$
begin
  begin
    perform 1 from public.parking_timers;
    raise exception 'FAIL  authenticated can read everybody''s timers';
  exception when insufficient_privilege then
    raise notice '  PASS  authenticated cannot read the timers table';
  end;
  begin
    insert into public.parking_timers (session_id, due_at, remind_at)
    values ('55555555-0000-0000-0000-000000000001', now(), now());
    raise exception 'FAIL  authenticated can insert a timer directly';
  exception when insufficient_privilege then
    raise notice '  PASS  authenticated cannot insert directly';
  end;
end $$;
reset role;

\echo ''
\echo 'parking_timers: all checks passed'
