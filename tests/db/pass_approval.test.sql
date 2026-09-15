-- A pass credit must not bypass the host, and must not be lost.
--
-- Two holes, one of them opened by the host-approval work itself: api/passes.js
-- predates it and inserted 'paid' directly without ever reading
-- requires_host_approval — so the old CHECK was satisfied by a row claiming it
-- never needed approval, and a season pass booked a stranger's driveway with
-- nobody asked.
\set ON_ERROR_STOP on
set client_min_messages = notice;

create or replace function assert(p_cond boolean, p_what text)
returns void language plpgsql as $$
begin
  if p_cond then raise notice '  PASS  %', p_what;
  else raise exception 'FAIL  %', p_what;
  end if;
end $$;

insert into public.rental_listings (id, title, address, lat, lng, space_type, status, requires_host_approval)
values
  ('66666666-0000-0000-0000-000000000001', 'A driveway',  '1 Manor Cl', 54.59, -5.93, 'driveway', 'active', true),
  ('66666666-0000-0000-0000-000000000002', 'A club park', 'Davitt',     54.58, -5.98, 'car_park', 'active', false);

insert into public.listing_passes (id, listing_id, name, num_credits, price_pence, active)
values ('77777777-0000-0000-0000-000000000001', '66666666-0000-0000-0000-000000000001',
        'Giants home games', 10, 8000, true);

insert into auth.users (id, email) values
  ('aaaa0000-0000-0000-0000-000000000001', 'passholder@test.local') on conflict do nothing;
insert into public.pass_purchases (id, pass_id, driver_id, credits_remaining)
values ('88888888-0000-0000-0000-000000000001', '77777777-0000-0000-0000-000000000001',
        'aaaa0000-0000-0000-0000-000000000001', 10);

--------------------------------------------------------------------------------
\echo ''
\echo '1. THE HOLE: a pass booking cannot claim it never needed approval'
--------------------------------------------------------------------------------
-- Exactly what api/passes.js used to write: status paid, no host response, and
-- requires_host_approval left at its default of false. The old CHECK passed it.
do $$
begin
  begin
    insert into public.bookings
      (listing_id, driver_email, amount_total_pence, booking_price_pence,
       application_fee_pence, service_fee_pence, status, pass_purchase_id)
    values ('66666666-0000-0000-0000-000000000001', 'pass@test.local', 0, 0, 0, 0, 'paid',
            '88888888-0000-0000-0000-000000000001');
    raise exception 'FAIL  a pass credit booked a driveway with the host never asked';
  exception when check_violation then
    raise notice '  PASS  a booking on an approval listing cannot be paid without a host response';
  end;
end $$;

-- The guard asks the LISTING, not the booking row, so opting out is impossible.
do $$
begin
  begin
    insert into public.bookings
      (listing_id, driver_email, amount_total_pence, booking_price_pence,
       application_fee_pence, service_fee_pence, status, requires_host_approval)
    values ('66666666-0000-0000-0000-000000000001', 'liar@test.local', 500, 400, 60, 100, 'paid', false);
    raise exception 'FAIL  a booking opted out of approval by setting its own flag to false';
  exception when check_violation then
    raise notice '  PASS  the guard reads the listing, so a booking cannot opt itself out';
  end;
end $$;

-- The correct shape is allowed: a request, awaiting the host.
insert into public.bookings
  (id, listing_id, driver_email, amount_total_pence, booking_price_pence,
   application_fee_pence, service_fee_pence, status, requires_host_approval,
   approval_deadline, pass_purchase_id)
values ('99999999-0000-0000-0000-000000000001', '66666666-0000-0000-0000-000000000001',
        'pass@test.local', 0, 0, 0, 0, 'awaiting_host', true, now() + interval '24 hours',
        '88888888-0000-0000-0000-000000000001');
select assert((select status from public.bookings where id = '99999999-0000-0000-0000-000000000001') = 'awaiting_host',
  'a pass booking on a driveway lands as a request');

-- And a club car park is still instant, pass or no pass.
insert into public.bookings
  (listing_id, driver_email, amount_total_pence, booking_price_pence,
   application_fee_pence, service_fee_pence, status, pass_purchase_id)
values ('66666666-0000-0000-0000-000000000002', 'pass2@test.local', 0, 0, 0, 0, 'paid',
        '88888888-0000-0000-0000-000000000001');
select assert((select count(*) from public.bookings where driver_email = 'pass2@test.local') = 1,
  'a pass booking on a club car park is still instant');

--------------------------------------------------------------------------------
\echo ''
\echo '2. The credit comes back'
--------------------------------------------------------------------------------
select public.redeem_pass_credit('88888888-0000-0000-0000-000000000001');
select assert((select credits_remaining from public.pass_purchases
                where id = '88888888-0000-0000-0000-000000000001') = 9,
  'redeeming takes a credit');

select assert(public.restore_pass_credit('88888888-0000-0000-0000-000000000001') = 10,
  'restoring gives it back — a host saying no must not cost the driver one');

-- A double restore cannot mint credits above what was bought.
select public.restore_pass_credit('88888888-0000-0000-0000-000000000001');
select public.restore_pass_credit('88888888-0000-0000-0000-000000000001');
select assert((select credits_remaining from public.pass_purchases
                where id = '88888888-0000-0000-0000-000000000001') = 10,
  'a repeated restore cannot mint credits beyond the ten that were bought');

-- And the decrement still refuses to go below zero.
do $$
begin
  for i in 1..10 loop perform public.redeem_pass_credit('88888888-0000-0000-0000-000000000001'); end loop;
end $$;
select assert((select credits_remaining from public.pass_purchases
                where id = '88888888-0000-0000-0000-000000000001') = 0,
  'ten redemptions empty a ten-credit pass exactly');
select assert(public.redeem_pass_credit('88888888-0000-0000-0000-000000000001') is null,
  'an eleventh redemption returns nothing rather than going negative');

--------------------------------------------------------------------------------
\echo ''
\echo '3. Only the server can hand credits back'
--------------------------------------------------------------------------------
-- restore_pass_credit mints a credit. Reachable by a driver, it is a free
-- season pass: call it ten times and you have ten more bookings. The mutation
-- that granted it to anon went through unnoticed until this was added.
grant usage on schema public to anon, authenticated;
select assert(not has_function_privilege('anon', 'public.restore_pass_credit(uuid)', 'execute'),
  'anon can restore a pass credit — that is a free pass');
select assert(not has_function_privilege('authenticated', 'public.restore_pass_credit(uuid)', 'execute'),
  'a signed-in driver can restore their own credits — that is a free pass');
select assert(has_function_privilege('service_role', 'public.restore_pass_credit(uuid)', 'execute'),
  'service_role can restore a credit');

-- The decrement is the driver-facing one and is called through the API with the
-- service key too; check it has not been opened up either.
select assert(not has_function_privilege('anon', 'public.redeem_pass_credit(uuid)', 'execute'),
  'anon can redeem a credit directly, bypassing the booking checks');

\echo ''
\echo 'pass approval: all checks passed'
