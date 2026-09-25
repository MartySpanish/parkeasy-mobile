-- The bottom of the funnel, and the two ways the number on the dashboard lies.
--
--   * TOO LOW. 'booking_paid' was fired only by the browser coming back from
--     Stripe, so every driver who paid and shut the receipt tab was missing
--     from the one number that says whether any of this works.
--   * TOO HIGH. Stripe delivers a webhook at least once and retries for days,
--     so the same payment arriving three times is three bookings unless
--     something stops it.
--
-- And for the win-back list, one way it quietly drops the people who matter
-- most: counting anybody with a bookings row as "has booked", when a declined
-- card and an abandoned checkout both leave one.
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
  ('aaaa3333-0000-0000-0000-000000000001', 'booked@test.local'),
  ('aaaa3333-0000-0000-0000-000000000002', 'never@test.local'),
  ('aaaa3333-0000-0000-0000-000000000003', 'tried-and-failed@test.local'),
  ('aaaa3333-0000-0000-0000-000000000004', 'guest-then-signed-up@test.local'),
  ('aaaa3333-0000-0000-0000-000000000005', 'abandoned@test.local')
  on conflict do nothing;

--------------------------------------------------------------------------------
\echo ''
\echo '1. Only the webhook can write a paid booking'
--------------------------------------------------------------------------------
-- This writes the number the business is judged on. A driver who could call it
-- could invent paid bookings.
select assert(not has_function_privilege('anon',
  'public.log_booking_paid(text,text,uuid,integer,uuid)', 'execute'),
  'anon cannot log a paid booking');
select assert(not has_function_privilege('authenticated',
  'public.log_booking_paid(text,text,uuid,integer,uuid)', 'execute'),
  'a signed-in driver cannot either');
select assert(has_function_privilege('service_role',
  'public.log_booking_paid(text,text,uuid,integer,uuid)', 'execute'),
  'the webhook can');
select assert(
  (select prosecdef from pg_proc
    where oid = 'public.log_booking_paid(text,text,uuid,integer,uuid)'::regprocedure),
  'log_booking_paid is SECURITY DEFINER');
select assert(
  (select proconfig::text like '%search_path=public, pg_temp%' from pg_proc
    where oid = 'public.log_booking_paid(text,text,uuid,integer,uuid)'::regprocedure),
  'and pins its search_path');

-- The re-engagement list is every registered email in one query.
select assert(not has_table_privilege('anon', 'public.users_never_booked', 'select'),
  'anon cannot read the list of every registered email');
select assert(not has_table_privilege('authenticated', 'public.users_never_booked', 'select'),
  'nor can a signed-in driver');
select assert(has_table_privilege('service_role', 'public.users_never_booked', 'select'),
  'the export script can');

--------------------------------------------------------------------------------
\echo ''
\echo '2. A paid booking is logged once, however many times Stripe says so'
--------------------------------------------------------------------------------
select assert(log_booking_paid('cs_test_1', 'bbbb0000-1111-2222-3333-444444444444',
                               null, 1250, 'aaaa3333-0000-0000-0000-000000000001'),
  'the first delivery writes the event');
select assert((select count(*) from app_events where event_name = 'booking_paid') = 1,
  'one row');

-- THE ONE THAT INFLATES THE DASHBOARD. Stripe is explicitly at-least-once.
select assert(not log_booking_paid('cs_test_1', 'bbbb0000-1111-2222-3333-444444444444',
                                   null, 1250, 'aaaa3333-0000-0000-0000-000000000001'),
  'a retry of the same checkout reports that it wrote nothing');
select assert(not log_booking_paid('cs_test_1', null, null, 9999, null),
  'and a retry with different details still writes nothing');
select assert((select count(*) from app_events where event_name = 'booking_paid') = 1,
  'still one row — three deliveries are one booking');

select assert(log_booking_paid('cs_test_2', 'bbbb0000-1111-2222-3333-555555555555',
                               null, 800, null),
  'a different checkout is a different booking');
select assert((select count(*) from app_events where event_name = 'booking_paid') = 2,
  'two bookings');

--------------------------------------------------------------------------------
\echo ''
\echo '3. What the event carries'
--------------------------------------------------------------------------------
select assert((select session_id from app_events
                where props ->> 'stripe_session' = 'cs_test_1')
              = 'bbbb0000-1111-2222-3333-444444444444',
  'the browsing session is recorded, so the funnel counts one session either way');
select assert((select user_id from app_events
                where props ->> 'stripe_session' = 'cs_test_1')
              = 'aaaa3333-0000-0000-0000-000000000001',
  'and the driver''s account when they had one');
select assert((select value_pence from app_events
                where props ->> 'stripe_session' = 'cs_test_1') = 1250,
  'and what actually moved');
select assert((select props ->> 'source' from app_events
                where props ->> 'stripe_session' = 'cs_test_1') = 'webhook',
  'and where it came from, so the two sources can be told apart');

-- A GUEST CHECKOUT HAS NO ACCOUNT, and a funnel that counted only signed-in
-- drivers would miss the people this business most needs to see.
select assert((select count(*) from app_events
                where props ->> 'stripe_session' = 'cs_test_2' and user_id is null) = 1,
  'a guest booking is still counted');

-- A malformed session id must not raise: an exception here fails the webhook,
-- and Stripe then retries a delivery whose real work is already done.
select assert(log_booking_paid('cs_test_3', 'not-a-uuid', null, 500, null),
  'a malformed browsing session is dropped, not thrown');
select assert((select session_id from app_events
                where props ->> 'stripe_session' = 'cs_test_3') is null,
  'and the event is still recorded without one');
select assert(log_booking_paid('cs_test_4', '', null, 500, null),
  'an empty browsing session is accepted the same way');

-- The uniqueness is on PAID bookings only. Another kind of event about the
-- same checkout — a refund, a dispute — is a different fact about it and has
-- to be recordable, which is why the index carries a WHERE clause rather than
-- covering the column outright.
insert into app_events (event_name, props)
values ('booking_abandoned', jsonb_build_object('stripe_session', 'cs_test_1'));
select assert((select count(*) from app_events
                where props ->> 'stripe_session' = 'cs_test_1') = 2,
  'a different event about the same checkout is allowed');

select assert(not log_booking_paid(null, 'bbbb0000-1111-2222-3333-666666666666', null, 500, null),
  'an event with no Stripe checkout is refused — it could never be deduped');
select assert(not log_booking_paid('   ', null, null, 500, null), 'and neither is a blank one');

--------------------------------------------------------------------------------
\echo ''
\echo '4. The funnel counts it'
--------------------------------------------------------------------------------
-- The whole point: app_events_summary's booking funnel has to see the
-- server-side event, or this migration changed nothing that anybody looks at.
-- FOUR paid bookings exist: two with a browsing session (cs_test_1, cs_test_2)
-- and two without (cs_test_3's session was malformed, cs_test_4's was empty).
-- A plain count(distinct session_id) sees only the first two, because
-- count(distinct) skips nulls — so two real payments would be invisible on the
-- only screen anybody looks at.
select assert(
  ((app_events_summary(30) -> 'booking_funnel' ->> 'booking_paid')::int) = 4,
  'a paid booking with no browsing session is still counted');

-- And the browser's own event for the same session does NOT add a second one,
-- which is what makes logging from both sides safe.
insert into app_events (event_name, session_id)
values ('booking_paid', 'bbbb0000-1111-2222-3333-444444444444');
select assert(
  ((app_events_summary(30) -> 'booking_funnel' ->> 'booking_paid')::int) = 4,
  'the browser and the webhook agreeing about one session is still one booking');

-- A browser event with no session at all is the one thing that cannot be
-- counted: there is nothing to tell it apart from any other. It is left out
-- rather than guessed at, which is why the webhook carries the Stripe id.
insert into app_events (event_name, session_id) values ('booking_paid', null);
select assert(
  ((app_events_summary(30) -> 'booking_funnel' ->> 'booking_paid')::int) = 4,
  'an unidentifiable event is left out rather than inflating the number');

-- The other steps stay on distinct sessions: they only ever happen in a
-- browser, so a null session there is a bug and not a booking.
insert into app_events (event_name, session_id) values
  ('listing_view', 'bbbb0000-1111-2222-3333-777777777777'),
  ('listing_view', 'bbbb0000-1111-2222-3333-777777777777'),
  ('listing_view', null);
select assert(
  ((app_events_summary(30) -> 'booking_funnel' ->> 'listing_view')::int) = 1,
  'one person opening a listing twice is one person');

--------------------------------------------------------------------------------
\echo ''
\echo '5. Who has never booked'
--------------------------------------------------------------------------------
insert into public.rental_listings (id, title, address) values
  ('cccc3333-0000-0000-0000-000000000001', 'A car park', '1 Test Street, Belfast')
  on conflict do nothing;

-- Paid: off the list.
insert into public.bookings
  (listing_id, driver_id, driver_email, amount_total_pence, booking_price_pence,
   application_fee_pence, service_fee_pence, stripe_session_id, status)
values
  ('cccc3333-0000-0000-0000-000000000001', 'aaaa3333-0000-0000-0000-000000000001',
   'booked@test.local', 1250, 1000, 250, 100, 'cs_paid_1', 'paid');

-- A DECLINED CARD AND AN ABANDONED CHECKOUT both leave a bookings row and
-- neither is somebody who has parked with us. They are the most winnable
-- people on the list, and "has no booking row" drops them.
insert into public.bookings
  (listing_id, driver_id, driver_email, amount_total_pence, booking_price_pence,
   application_fee_pence, service_fee_pence, stripe_session_id, status)
values
  ('cccc3333-0000-0000-0000-000000000001', 'aaaa3333-0000-0000-0000-000000000003',
   'tried-and-failed@test.local', 1250, 1000, 250, 100, 'cs_failed_1', 'failed'),
  ('cccc3333-0000-0000-0000-000000000001', 'aaaa3333-0000-0000-0000-000000000005',
   'abandoned@test.local', 1250, 1000, 250, 100, 'cs_pending_1', 'pending');

-- A GUEST BOOKING WITH NO ACCOUNT, by somebody who signed up afterwards. They
-- have parked with us, so they are not somebody to win back — and the only
-- thing joining the two is the email address.
insert into public.bookings
  (listing_id, driver_id, driver_email, amount_total_pence, booking_price_pence,
   application_fee_pence, service_fee_pence, stripe_session_id, status)
values
  ('cccc3333-0000-0000-0000-000000000001', null,
   'GUEST-THEN-SIGNED-UP@test.local', 1250, 1000, 250, 100, 'cs_guest_1', 'paid');

select assert((select count(*) from users_never_booked
                where email = 'booked@test.local') = 0,
  'somebody who paid is not on the win-back list');
select assert((select count(*) from users_never_booked
                where email = 'tried-and-failed@test.local') = 1,
  'a declined card counts as never booked');
select assert((select count(*) from users_never_booked
                where email = 'abandoned@test.local') = 1,
  'and so does an abandoned checkout');
select assert((select count(*) from users_never_booked
                where email = 'never@test.local') = 1,
  'somebody who never reached checkout is on it');
select assert((select count(*) from users_never_booked
                where email = 'guest-then-signed-up@test.local') = 0,
  'a guest booking is matched on email, whatever case it was typed in');

select assert((select count(*) from users_never_booked) = 3,
  'three of the five accounts have never parked with us');

-- The columns the export needs, and nothing more than the list requires.
-- Against a KNOWN signup date, not ">= 0" — which a hardcoded zero satisfies
-- just as well, and the age is the number that decides whether a win-back
-- email is a nudge or a different letter entirely.
update auth.users set created_at = now() - interval '200 days'
 where email = 'never@test.local';
select assert((select days_since_signup from users_never_booked
                where email = 'never@test.local') = 200,
  'the list says how many days they have been signed up without ever parking');
select assert((select days_since_signup from users_never_booked
                where email = 'abandoned@test.local') = 0,
  'and somebody who signed up today reads as today');
select assert(count(*) = 3, 'the view exposes an id, an email, a date and an age')
  from information_schema.columns where table_name = 'users_never_booked'
   and column_name in ('email', 'registered_at', 'days_since_signup');

-- security_invoker = false, or the view returns nothing at all to the caller
-- the export script uses.
select assert(
  (select reloptions::text from pg_class where oid = 'public.users_never_booked'::regclass)
    not like '%security_invoker=true%',
  'the view reads auth.users as its owner');

\echo ''
