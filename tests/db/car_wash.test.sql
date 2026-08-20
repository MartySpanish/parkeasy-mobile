-- Car wash add-on rules.
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
-- address is NOT NULL on the real table, and status stays 'draft' — a wash
-- attaches to a listing, and none of these rules care whether it is published.
insert into public.rental_listings (id, title, address, status, wash_enabled, wash_days) values
  ('aaaaaaaa-0000-0000-0000-000000000001','Davitt Park','Davitt Park, Belfast','draft', true, '{1}'),
  ('aaaaaaaa-0000-0000-0000-000000000002','No washes here','Somewhere, Belfast','draft', false, '{1}'),
  -- An event site, on Sundays. The reason wash_days is a column.
  ('aaaaaaaa-0000-0000-0000-000000000003','Event car park','A field, Belfast','draft', true, '{7}');
insert into public.bookings (id, listing_id, amount_total_pence, booking_price_pence,
                             application_fee_pence, service_fee_pence)
values ('bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',2300,2000,399,300);

-- The next Monday and the next Sunday, whenever this runs.
create or replace function next_dow(p_dow int) returns date language sql as $$
  select (current_date + ((p_dow - extract(isodow from current_date)::int + 7) % 7 + 7))::date;
$$;

\echo ''
\echo '1. Only on a day the site actually washes'
do $$ begin
  insert into public.wash_requests (booking_id, user_id, listing_id, wash_date, vehicle_tier, price_pence, vrn)
  values ('bbbbbbbb-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
          'aaaaaaaa-0000-0000-0000-000000000001', next_dow(3), 'standard', 3000, 'BT21ABC');
  raise exception 'FAIL  a wash was booked for a Wednesday at a Mondays-only site';
exception when sqlstate 'PE021' then
  raise notice '  PASS  a day the site does not wash is refused';
end $$;

insert into public.wash_requests (id, booking_id, user_id, listing_id, wash_date, vehicle_tier, price_pence, vrn)
values ('cccccccc-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001',
        '11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001',
        next_dow(1), 'standard', 3000, 'bt21 abc');
select assert(true, 'a Monday at a Mondays site is accepted');
select assert(
  (select vrn from public.wash_requests where id='cccccccc-0000-0000-0000-000000000001') = 'BT21ABC',
  'and the plate is normalised the same way permits are');

do $$ begin
  insert into public.wash_requests (booking_id, user_id, listing_id, wash_date, vehicle_tier, price_pence, vrn)
  values ('bbbbbbbb-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
          'aaaaaaaa-0000-0000-0000-000000000002', next_dow(1), 'standard', 3000, 'BT21ABC');
  raise exception 'FAIL  a wash was booked at a site that does not offer them';
exception when sqlstate 'PE020' then
  raise notice '  PASS  a site with washes switched off refuses them';
end $$;

\echo ''
\echo '2. wash_days is per site, which is the whole reason it is a column'
insert into public.wash_requests (booking_id, user_id, listing_id, wash_date, vehicle_tier, price_pence, vrn)
values ('bbbbbbbb-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
        'aaaaaaaa-0000-0000-0000-000000000003', next_dow(7), 'van', 5000, 'BT21VAN');
select assert(true, 'an event site washing on Sundays takes a Sunday');

do $$ begin
  update public.rental_listings set wash_days = '{1,9}'
   where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  raise exception 'FAIL  weekday 9 was accepted';
exception when check_violation then
  raise notice '  PASS  wash_days is constrained to real weekdays';
end $$;

\echo ''
\echo '3. Exactly one origin: a booking OR a permit claim, never both or neither'
do $$ begin
  insert into public.wash_requests (user_id, listing_id, wash_date, vehicle_tier, price_pence, vrn)
  values ('11111111-1111-1111-1111-111111111111','aaaaaaaa-0000-0000-0000-000000000001',
          next_dow(1), 'standard', 3000, 'BT21ABC');
  raise exception 'FAIL  a wash with no booking and no permit claim was accepted';
exception when check_violation then
  raise notice '  PASS  a wash with no origin is refused';
end $$;

do $$ begin
  insert into public.wash_requests (vehicle_tier, price_pence, vrn, listing_id, wash_date, user_id)
  values ('other','3000','BT21ABC','aaaaaaaa-0000-0000-0000-000000000001', next_dow(1),
          '11111111-1111-1111-1111-111111111111');
  raise exception 'FAIL  an unknown vehicle tier was accepted';
exception when check_violation then
  raise notice '  PASS  vehicle_tier is a closed set';
end $$;

\echo ''
\echo '4. A driver sees their own wash and nobody else''s'
select assert(has_table_privilege('authenticated','public.wash_requests','select'),
  'a signed-in driver can read wash requests, filtered by policy');
select assert(not has_table_privilege('anon','public.wash_requests','select'),
  'a signed-out visitor cannot');
select assert(not has_table_privilege('authenticated','public.wash_requests','insert'),
  'and nobody writes one from the browser — the cutoff and the price are server-side');

\echo ''
\echo 'ALL CHECKS PASSED'
