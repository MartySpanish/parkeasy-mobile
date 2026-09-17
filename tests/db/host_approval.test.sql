-- A host at their own house must be able to say no.
--
-- The feature is one sentence — a booking on a driveway is a REQUEST until the
-- host accepts — and one thing can go wrong that actually matters: money
-- leaving a driver's card for a space the host never agreed to. That is what
-- the constraint below exists for, and what most of these checks are about.
\set ON_ERROR_STOP on
set client_min_messages = notice;

create or replace function assert(p_cond boolean, p_what text)
returns void language plpgsql as $$
begin
  if p_cond then raise notice '  PASS  %', p_what;
  else raise exception 'FAIL  %', p_what;
  end if;
end $$;

--------------------------------------------------------------------------------
\echo ''
\echo '1. Which listings ask, and which do not'
--------------------------------------------------------------------------------
insert into public.rental_listings (id, title, address, lat, lng, space_type, status)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'A driveway', '1 Manor Close', 54.59, -5.93, 'driveway', 'active'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'A club car park', 'Davitt Park', 54.58, -5.98, 'car_park', 'active');

-- The migration only backfilled rows that existed when it ran, so set these the
-- way the app would.
update public.rental_listings set requires_host_approval = true
 where id = 'aaaaaaaa-0000-0000-0000-000000000001';

select assert((select requires_host_approval from public.rental_listings
                where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'a driveway asks the host first');
select assert(not (select requires_host_approval from public.rental_listings
                where id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  'a club car park stays instant — a marshal is not waiting by their phone');

-- The column defaults OFF. A new car park must never become request-only by
-- accident: that turns a working instant booking into one nobody answers.
select assert((select column_default from information_schema.columns
                where table_schema='public' and table_name='rental_listings'
                  and column_name='requires_host_approval') like 'false%',
  'requires_host_approval defaults to false');

-- THE BACKFILL, on listings that predate the migration. These two came from
-- tests/db/host_approval_seed.sql and are the only rows here the migration
-- actually touched — everything above was created afterwards and flagged by
-- hand, so a migration that backfilled nothing would still pass those.
select assert((select requires_host_approval from public.rental_listings
                where id = 'cccccccc-0000-0000-0000-000000000001'),
  'backfill: an existing driveway was switched to request-only');
select assert(not (select requires_host_approval from public.rental_listings
                where id = 'cccccccc-0000-0000-0000-000000000002'),
  'backfill: an existing car park was left instant');

--------------------------------------------------------------------------------
\echo ''
\echo '2. THE INVARIANT: no capture without an answer'
--------------------------------------------------------------------------------
insert into public.bookings
  (id, listing_id, driver_email, amount_total_pence, booking_price_pence,
   application_fee_pence, service_fee_pence, status, requires_host_approval, approval_deadline)
values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   'driver@example.test', 500, 400, 60, 100, 'awaiting_host', true, now() + interval '24 hours');

do $$
begin
  begin
    update public.bookings set status = 'paid'
     where id = 'bbbbbbbb-0000-0000-0000-000000000001';
    raise exception 'FAIL  an approval booking was marked paid with no host response';
  exception when check_violation then
    raise notice '  PASS  an approval booking cannot be paid until the host answers';
  end;
end $$;

-- With an answer recorded, the same update is allowed.
update public.bookings
   set status = 'paid', host_responded_at = now()
 where id = 'bbbbbbbb-0000-0000-0000-000000000001';
select assert((select status from public.bookings where id = 'bbbbbbbb-0000-0000-0000-000000000001') = 'paid',
  'once the host has answered, the booking can be captured');

-- The constraint must NOT get in the way of an ordinary instant booking.
insert into public.bookings
  (id, listing_id, driver_email, amount_total_pence, booking_price_pence,
   application_fee_pence, service_fee_pence, status, requires_host_approval)
values
  ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000002',
   'driver2@example.test', 500, 400, 60, 100, 'paid', false);
select assert((select status from public.bookings where id = 'bbbbbbbb-0000-0000-0000-000000000002') = 'paid',
  'a car park booking is still paid outright, with no host response needed');

--------------------------------------------------------------------------------
\echo ''
\echo '3. The states a request can end in'
--------------------------------------------------------------------------------
insert into public.bookings
  (id, listing_id, driver_email, amount_total_pence, booking_price_pence,
   application_fee_pence, service_fee_pence, status, requires_host_approval, approval_deadline)
values
  ('bbbbbbbb-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001',
   'd3@example.test', 500, 400, 60, 100, 'awaiting_host', true, now() + interval '2 hours'),
  ('bbbbbbbb-0000-0000-0000-000000000004', 'aaaaaaaa-0000-0000-0000-000000000001',
   'd4@example.test', 500, 400, 60, 100, 'awaiting_host', true, now() - interval '1 hour');

update public.bookings
   set status = 'declined', host_responded_at = now(), host_decline_reason = 'Car in the drive that day'
 where id = 'bbbbbbbb-0000-0000-0000-000000000003';
select assert((select status from public.bookings where id = 'bbbbbbbb-0000-0000-0000-000000000003') = 'declined',
  'a host can decline, with a reason');

update public.bookings set status = 'expired'
 where id = 'bbbbbbbb-0000-0000-0000-000000000004';
select assert((select status from public.bookings where id = 'bbbbbbbb-0000-0000-0000-000000000004') = 'expired',
  'a request the host never answered expires');

-- A status the code does not write is refused outright.
do $$
begin
  begin
    update public.bookings set status = 'accepted'
     where id = 'bbbbbbbb-0000-0000-0000-000000000003';
    raise exception 'FAIL  the status column accepted a value nothing writes';
  exception when check_violation then
    raise notice '  PASS  an unknown status is refused — a typo cannot hide a booking';
  end;
end $$;

--------------------------------------------------------------------------------
\echo ''
\echo '4. The queue the host and the expiry sweep both read'
--------------------------------------------------------------------------------
select assert(exists (select 1 from pg_indexes
                where tablename = 'bookings' and indexname = 'bookings_awaiting_host_idx'),
  'the awaiting_host index exists');

-- Expiry is "waiting, and past the deadline" — not "waiting", or it would
-- cancel requests the host still has time to answer.
insert into public.bookings
  (id, listing_id, driver_email, amount_total_pence, booking_price_pence,
   application_fee_pence, service_fee_pence, status, requires_host_approval, approval_deadline)
values
  ('bbbbbbbb-0000-0000-0000-000000000005', 'aaaaaaaa-0000-0000-0000-000000000001',
   'd5@example.test', 500, 400, 60, 100, 'awaiting_host', true, now() - interval '5 minutes'),
  ('bbbbbbbb-0000-0000-0000-000000000006', 'aaaaaaaa-0000-0000-0000-000000000001',
   'd6@example.test', 500, 400, 60, 100, 'awaiting_host', true, now() + interval '5 minutes');

select assert((select count(*) from public.bookings
                where status = 'awaiting_host' and approval_deadline < now()) = 1,
  'exactly the lapsed request is due for expiry');
select assert((select count(*) from public.bookings
                where status = 'awaiting_host' and approval_deadline >= now()) = 1,
  'the request still inside its window is left alone');

\echo ''
\echo 'host approval: all checks passed'
