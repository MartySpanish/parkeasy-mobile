-- A table that drives outbound messaging, and the ways it goes wrong.
--
-- push_subscriptions is a send list. Three things have to hold or it stops
-- being one: a browser must be able to refresh its own row forever (or it
-- silently goes quiet), nobody may read or write the table directly (it is the
-- shape of the app_events open-INSERT that got flagged in July), and one
-- browser must never end up holding two rows (one person, two copies of every
-- notification).
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
  ('bbbb0000-0000-0000-0000-000000000001', 'pushy@test.local') on conflict do nothing;

--------------------------------------------------------------------------------
\echo ''
\echo '1. The table is not a write primitive'
--------------------------------------------------------------------------------
select assert(relrowsecurity, 'row level security is on')
  from pg_class where oid = 'public.push_subscriptions'::regclass;

select assert(count(*) = 0, 'no policies at all — the function is the whole surface')
  from pg_policies where tablename = 'push_subscriptions';

select assert(count(*) = 0, 'anon and authenticated hold no table privilege')
  from information_schema.role_table_grants
 where table_name = 'push_subscriptions' and grantee in ('anon', 'authenticated');

-- RLS with no policy is a closed door, but only for a role that is not the
-- owner and does not bypass. Both facts are asserted rather than assumed.
select assert(not rolbypassrls, 'authenticated does not bypass RLS')
  from pg_roles where rolname = 'authenticated';
select assert(rolbypassrls, 'service_role does bypass RLS — the send path reads the list')
  from pg_roles where rolname = 'service_role';

select assert(
  has_function_privilege('anon', 'public.save_push_subscription(text,text,text,uuid,text)', 'execute'),
  'anon can register a subscription');
select assert(
  has_function_privilege('anon', 'public.remove_push_subscription(text)', 'execute'),
  'anon can turn notifications off');
select assert(
  (select prosecdef from pg_proc where oid = 'public.save_push_subscription(text,text,text,uuid,text)'::regprocedure),
  'save_push_subscription is SECURITY DEFINER');
select assert(
  (select proconfig::text like '%search_path=public, pg_temp%'
     from pg_proc where oid = 'public.save_push_subscription(text,text,text,uuid,text)'::regprocedure),
  'save_push_subscription pins its search_path');

--------------------------------------------------------------------------------
\echo ''
\echo '2. Shape is refused, not stored'
--------------------------------------------------------------------------------
select assert(public.save_push_subscription(null, 'k', 'a') is false, 'a null endpoint is refused');
select assert(public.save_push_subscription('http://evil.test/x', 'k', 'a') is false,
              'a non-https endpoint is refused');
select assert(public.save_push_subscription('ftp://evil.test/x', 'k', 'a') is false,
              'a non-url endpoint is refused');
select assert(public.save_push_subscription('https://x.test/' || repeat('p', 1001), 'k', 'a') is false,
              'a 1000+ character endpoint is refused');
select assert(public.save_push_subscription('https://x.test/a', null, 'a') is false, 'a null p256dh is refused');
select assert(public.save_push_subscription('https://x.test/a', 'k', null) is false, 'a null auth is refused');
select assert(public.save_push_subscription('https://x.test/a', repeat('k', 201), 'a') is false,
              'an over-long p256dh is refused');
select assert(public.save_push_subscription('https://x.test/a', 'k', repeat('a', 101)) is false,
              'an over-long auth is refused');
select assert(count(*) = 0, 'nothing refused was stored') from public.push_subscriptions;

--------------------------------------------------------------------------------
\echo ''
\echo '3. A real subscription, and the account it belongs to'
--------------------------------------------------------------------------------
-- Signed in: user_id comes from auth.uid(), never from the caller — there is no
-- parameter for it, which is the point.
select set_config('request.jwt.claim.sub', 'bbbb0000-0000-0000-0000-000000000001', false);
select assert(public.save_push_subscription(
                'https://fcm.googleapis.com/fcm/send/AAA', 'key-aaa', 'auth-aaa',
                'cccc0000-0000-0000-0000-00000000000a', 'Chrome/Android') is true,
              'a well-formed subscription is stored');
select assert(user_id = 'bbbb0000-0000-0000-0000-000000000001'
              and session_id = 'cccc0000-0000-0000-0000-00000000000a'
              and expired_at is null,
              'it is attributed to the signed-in account and its session')
  from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/AAA';

-- Signed out: a guest holding a parking timer is a legitimate subscriber.
select set_config('request.jwt.claim.sub', '', false);
select assert(public.save_push_subscription(
                'https://updates.push.services.mozilla.com/wpush/v2/BBB', 'key-bbb', 'auth-bbb',
                'cccc0000-0000-0000-0000-00000000000b') is true,
              'a signed-out browser can subscribe');
select assert(user_id is null, 'a guest subscription has no account on it')
  from public.push_subscriptions where endpoint like '%/wpush/v2/BBB';

select assert(public.save_push_subscription('https://x.test/ua', 'k', 'a', null, repeat('U', 900)) is true,
              'a 900-character user agent does not sink the whole registration');
select assert(length(user_agent) = 300, 'a long user agent is truncated, not rejected')
  from public.push_subscriptions where endpoint = 'https://x.test/ua';

--------------------------------------------------------------------------------
\echo ''
\echo '4. One browser, one row — re-subscribing refreshes'
--------------------------------------------------------------------------------
update public.push_subscriptions
   set last_seen_at = now() - interval '40 days'
 where endpoint = 'https://fcm.googleapis.com/fcm/send/AAA';

select assert(public.save_push_subscription(
                'https://fcm.googleapis.com/fcm/send/AAA', 'key-aaa-rotated', 'auth-aaa-rotated',
                'cccc0000-0000-0000-0000-00000000000a') is true,
              're-subscribing the same browser succeeds');
select assert(count(*) = 1, 'the same endpoint did not produce a second row')
  from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/AAA';
select assert(p256dh = 'key-aaa-rotated' and auth = 'auth-aaa-rotated',
              'rotated keys replaced the old ones')
  from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/AAA';
select assert(last_seen_at > now() - interval '1 minute', 'last_seen_at moved forward')
  from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/AAA';

-- A refresh that arrives signed out must not wipe the account off the row, or
-- every "your booking starts in 20 minutes" loses its addressee.
select assert(public.save_push_subscription(
                'https://fcm.googleapis.com/fcm/send/AAA', 'key-aaa-3', 'auth-aaa-3') is true,
              'a signed-out refresh of a signed-in subscription succeeds');
select assert(user_id = 'bbbb0000-0000-0000-0000-000000000001',
              'a signed-out refresh kept the account it was already attributed to')
  from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/AAA';
select assert(session_id = 'cccc0000-0000-0000-0000-00000000000a',
              'a refresh with no session kept the session it had')
  from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/AAA';

--------------------------------------------------------------------------------
\echo ''
\echo '5. The cap bounds new rows, and never blocks a refresh'
--------------------------------------------------------------------------------
do $$
declare i integer;
begin
  for i in 1..5 loop
    if not public.save_push_subscription(
         'https://fcm.googleapis.com/fcm/send/CAP' || i, 'k', 'a',
         'dddd0000-0000-0000-0000-00000000000d') then
      raise exception 'FAIL  subscription % of 5 was refused', i;
    end if;
  end loop;
end $$;
select assert(count(*) = 5, 'five browsers on one session is allowed')
  from public.push_subscriptions where session_id = 'dddd0000-0000-0000-0000-00000000000d';

select assert(public.save_push_subscription(
                'https://fcm.googleapis.com/fcm/send/CAP6', 'k', 'a',
                'dddd0000-0000-0000-0000-00000000000d') is false,
              'a sixth NEW browser on the same session is refused');

-- THE BUG THIS SECTION EXISTS FOR. At the cap, a browser re-registering — which
-- happens on every load — was counted against the cap it was already inside,
-- refused, and went quiet for good.
select assert(public.save_push_subscription(
                'https://fcm.googleapis.com/fcm/send/CAP3', 'k-new', 'a-new',
                'dddd0000-0000-0000-0000-00000000000d') is true,
              'a browser AT the cap can still refresh its own subscription');
select assert(p256dh = 'k-new', 'the refresh at the cap actually landed')
  from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/CAP3';

-- An expired row does not hold a slot: a browser that went away should not
-- stop a new one being registered.
update public.push_subscriptions set expired_at = now()
 where endpoint = 'https://fcm.googleapis.com/fcm/send/CAP1';
select assert(public.save_push_subscription(
                'https://fcm.googleapis.com/fcm/send/CAP7', 'k', 'a',
                'dddd0000-0000-0000-0000-00000000000d') is true,
              'an expired subscription frees its slot');

--------------------------------------------------------------------------------
\echo ''
\echo '6. Turning notifications off, and back on'
--------------------------------------------------------------------------------
select assert(public.remove_push_subscription(null) is false, 'a null endpoint removes nothing');
select assert(public.remove_push_subscription('https://fcm.googleapis.com/fcm/send/NOPE') is false,
              'an unknown endpoint reports nothing removed');
select assert(public.remove_push_subscription('https://fcm.googleapis.com/fcm/send/AAA') is true,
              'a live subscription is removed');
select assert(expired_at is not null, 'removal marks it expired rather than deleting the row')
  from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/AAA';
select assert(count(*) = 1, 'the row is still there, so the churn is visible')
  from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/AAA';
select assert(public.remove_push_subscription('https://fcm.googleapis.com/fcm/send/AAA') is false,
              'removing it twice reports nothing removed the second time');

select assert(public.save_push_subscription(
                'https://fcm.googleapis.com/fcm/send/AAA', 'k-back', 'a-back',
                'cccc0000-0000-0000-0000-00000000000a') is true,
              'turning notifications back on succeeds');
select assert(expired_at is null and p256dh = 'k-back',
              'the same row came back live rather than a duplicate being made')
  from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/AAA';
select assert(count(*) = 1, 'still one row for that browser')
  from public.push_subscriptions where endpoint = 'https://fcm.googleapis.com/fcm/send/AAA';

--------------------------------------------------------------------------------
\echo ''
\echo '7. The send path can read the list; a driver cannot'
--------------------------------------------------------------------------------
select assert(count(*) > 0, 'the live list is readable by the owner/service path')
  from public.push_subscriptions where expired_at is null;

set role authenticated;
do $$
begin
  begin
    perform 1 from public.push_subscriptions;
    raise exception 'FAIL  authenticated can read the whole send list';
  exception when insufficient_privilege then
    raise notice '  PASS  authenticated cannot read the send list';
  end;
  begin
    insert into public.push_subscriptions (endpoint, p256dh, auth)
    values ('https://evil.test/x', 'k', 'a');
    raise exception 'FAIL  authenticated can insert straight into the send list';
  exception when insufficient_privilege then
    raise notice '  PASS  authenticated cannot insert directly';
  end;
  begin
    update public.push_subscriptions set endpoint = 'https://evil.test/y';
    raise exception 'FAIL  authenticated can repoint a subscription';
  exception when insufficient_privilege then
    raise notice '  PASS  authenticated cannot repoint a subscription';
  end;
end $$;
reset role;

\echo ''
\echo 'push_subscriptions: all checks passed'
