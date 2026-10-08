-- Which spaces are earning, which cannot be booked, and why.
--
-- The interesting cases are not the listing that works. They are the three
-- shapes of "looks fine, cannot take a booking", because every one of them was
-- live in production and silent:
--
--   · status 'active' with an availability window that has CLOSED (Belfast
--     Royal Academy, since 18 August)
--   · status 'draft' with 570 real spaces behind it (the APCOA car parks)
--   · status 'active' with no price set at all
--
-- And one number that must not be invented: occupancy on a listing that has
-- never had a bookable day is NULL, not 0%.
\set ON_ERROR_STOP on
set client_min_messages = notice;

create or replace function assert(p_cond boolean, p_what text)
returns void language plpgsql as $$
begin
  if p_cond then raise notice '  PASS  %', p_what;
  else raise exception 'FAIL  %', p_what;
  end if;
end $$;

-- rental_listings.owner_id references auth.users, which the harness stubs.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'host@example.com')
on conflict (id) do nothing;

-- ACTIVE LISTINGS MUST SATISFY THE REAL PUBLISH CONSTRAINTS, which
-- 20260704_listing_requirements.sql enforces in the database: instructions of
-- 30+ characters, coordinates, a phone, an availability pattern, a price, 5
-- photos for an organization, and the full org block including
-- approved_by_founder. Writing the fixtures to pass them is the point — a test
-- that inserts states the database forbids proves nothing about production.
insert into public.rental_listings
  (id, owner_id, title, address, status, host_type, spaces,
   price_per_day, price_per_hour, available_from, available_until, photos,
   instructions, lat, lng, contact_phone, availability,
   org_name, org_type, org_registration, access_contact_name, access_contact_phone,
   access_method, approved_by_founder)
values
  -- Earning: day-priced, open-ended, 10 spaces.
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Earning Club', '1 Club Road, Belfast', 'active', 'organization', 10,
   20.00, null, null, null, array['a1.jpg','a2.jpg','a3.jpg','a4.jpg','a5.jpg'],
   'Gates open at nine, close at half eight. Park on the tarmac only.', 54.59, -5.93, '028 9000 0001', 'Always',
   'Earning Club', 'sports club', 'NI000001', 'A Secretary', '028 9000 0001',
   'Book on ParkEasy and the club opens the gates for the window you booked.', true),
  -- Active, and its window shut yesterday. The BRA case.
  ('aaaaaaaa-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'Window Closed School', '2 School Road, Belfast', 'active', 'organization', 64,
   15.00, null, current_date - 60, current_date - 1, array['b1.jpg','b2.jpg','b3.jpg','b4.jpg','b5.jpg'],
   'Front car park only, eight until five, term time Monday to Friday.', 54.61, -5.94, '028 9000 0002', 'Weekdays',
   'Window Closed School', 'school', 'NI000002', 'A Bursar', '028 9000 0002',
   'Book on ParkEasy and the school expects you at the front gate from eight.', true),
  -- Draft with real capacity. The APCOA case. A draft is exempt from all of
  -- the publish constraints, which is exactly why 790 spaces can sit in one.
  ('aaaaaaaa-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'Draft Multi-storey', '3 Quay Street, Belfast', 'draft', 'organization', 200,
   null, null, null, null, '{}',
   null, null, null, null, null, null, null, null, null, null, null, false),
  -- Active but its window has not opened.
  ('aaaaaaaa-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111',
   'Opens Next Month', '5 Future Lane, Belfast', 'active', 'organization', 20,
   12.00, null, current_date + 30, current_date + 90, array['d1.jpg','d2.jpg','d3.jpg','d4.jpg','d5.jpg'],
   'Visitor bays beside the main entrance, marked in yellow paint.', 54.60, -5.92, '028 9000 0005', 'Event dates only',
   'Opens Next Month', 'business', 'NI000005', 'A Manager', '028 9000 0005',
   'Book on ParkEasy and the barrier is raised for the dates you booked.', true);

-- Two paid bookings on the earner: one day and three days. On a day-priced
-- site duration_hours carries the number of DAYS, so this is 4 space-days.
-- Driver pays £23 for one day (£20 + £3 fee), our cut £6.
insert into public.bookings
  (id, listing_id, host_id, starts_at, duration_hours, amount_total_pence,
   booking_price_pence, application_fee_pence, service_fee_pence, status, created_at)
values
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', now() - interval '10 days', 1,
   2300, 2000, 600, 300, 'paid', now() - interval '10 days'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', now() - interval '5 days', 3,
   6900, 6000, 1800, 900, 'paid', now() - interval '5 days'),
  -- A cancelled row with no payment intent: the 4 August test traffic shape.
  -- It must be counted separately and must not touch any money column.
  ('bbbbbbbb-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111', now() - interval '3 days', 1,
   2300, 2000, 600, 300, 'cancelled', now() - interval '3 days');

-- ── What the report says ─────────────────────────────────────────────────────
do $$
declare r record;
begin
  select * into r from public.listing_performance(365)
   where title = 'Earning Club';

  perform assert(r.bookable_now, 'the earning listing is bookable');
  perform assert(r.blocked_reason is null, 'a bookable listing has no blocked reason');
  perform assert(r.paid_bookings = 2, 'two paid bookings counted, got ' || r.paid_bookings);
  perform assert(r.cancelled_bookings = 1, 'one cancelled booking counted separately');
  -- £23 + £69 = £92 gross; our cut £6 + £18 = £24; host keeps £68.
  perform assert(r.gross_pence = 9200, 'gross is 9200, got ' || r.gross_pence);
  perform assert(r.platform_pence = 2400, 'platform cut is 2400, got ' || r.platform_pence);
  perform assert(r.host_pence = 6800, 'host share is 6800, got ' || r.host_pence);
  -- THE CANCELLED ROW MUST NOT BE IN THE MONEY. If the status filter is
  -- dropped this becomes 11500 / 3000 and every revenue figure is inflated by
  -- test traffic.
  perform assert(r.gross_pence <> 11500, 'a cancelled booking is counted as revenue');
  -- 1 day + 3 days.
  perform assert(r.space_days_sold = 4, 'space-days sold is 4, got ' || r.space_days_sold);
  perform assert(r.space_days_available = 366 * 10,
    'capacity is 366 days x 10 spaces, got ' || r.space_days_available);
  perform assert(r.revenue_per_space_pence = 920,
    'revenue per space is 920, got ' || r.revenue_per_space_pence);
  perform assert(r.occupancy_pct is not null, 'an earning listing has an occupancy figure');
end $$;

do $$
declare r record;
begin
  select * into r from public.listing_performance(365)
   where title = 'Window Closed School';
  -- THE BRA CASE. 'active' and completely unsellable.
  perform assert(r.status = 'active', 'the row is still active');
  perform assert(not r.bookable_now, 'a closed window still reads as bookable');
  perform assert(r.blocked_reason like 'availability window closed%',
    'the closed window is not named: ' || coalesce(r.blocked_reason, '(null)'));
  perform assert(r.blocked_reason not like '%draft%', 'a closed window is reported as a draft');
end $$;

do $$
declare r record;
begin
  select * into r from public.listing_performance(365)
   where title = 'Draft Multi-storey';
  -- THE APCOA CASE. The capacity is the point: a draft hiding hundreds of spaces is
  -- the most valuable row in the table and must not be reported as 0 spaces.
  perform assert(not r.bookable_now, 'a draft reads as bookable');
  perform assert(r.blocked_reason = 'draft', 'the draft is not named');
  -- capacity_range caps spaces at 200, so the fixture uses the ceiling rather
  -- than APCOA's real 570. The point stands: a draft must not report 0.
  perform assert(r.spaces = 200, 'the draft lost its capacity, got ' || r.spaces);
  perform assert(r.photo_count = 0, 'photo count on a null photos array is not 0');
  -- NOT 0%. A listing that has never had a bookable day has no occupancy, and
  -- printing 0.00% invites "so it is failing" about a space that was never on
  -- sale. Mutation: return 0 instead of null here and this fails.
  perform assert(r.occupancy_pct is null,
    'a draft was given an occupancy figure of ' || coalesce(r.occupancy_pct::text, 'null'));
end $$;

-- 'no price set' IS AN UNREACHABLE BRANCH FOR AN ACTIVE LISTING, and that is
-- worth recording rather than testing around. publish_price forbids the state
-- outright, so the branch in listing_performance is defensive only. Asserting
-- the constraint is the honest version of that test: if somebody ever relaxes
-- publish_price, this fails and the branch becomes load-bearing.
do $$
declare ok boolean := false;
begin
  begin
    insert into public.rental_listings
      (owner_id, title, address, status, host_type, spaces, photos, instructions,
       lat, lng, contact_phone, availability)
    values ('11111111-1111-1111-1111-111111111111', 'No Price Yet', '4 Home Street, Belfast',
      'active', 'residential', 1, array['c1.jpg','c2.jpg','c3.jpg'],
      'Driveway to the left of the house, behind the blue gate.', 54.58, -5.95, '028 9000 0004', 'Always');
  exception when check_violation then ok := true;
  end;
  perform assert(ok, 'the database now allows an active listing with no price — '
    || 'listing_performance''s "no price set" branch has become load-bearing and needs a real test');
end $$;

do $$
declare r record;
begin
  select * into r from public.listing_performance(365) where title = 'Opens Next Month';
  perform assert(not r.bookable_now, 'a future window reads as bookable now');
  perform assert(r.blocked_reason like 'not available until%', 'the future window is not named');
  -- Tomorrow is not capacity that went unsold.
  perform assert(r.space_days_available = 0,
    'a listing that has not opened was given capacity: ' || r.space_days_available);
end $$;

-- ── The window argument ──────────────────────────────────────────────────────
do $$
declare n integer;
begin
  select paid_bookings into n from public.listing_performance(7)
   where title = 'Earning Club';
  -- Only the 5-day-old booking is inside a 7-day window.
  perform assert(n = 1, 'the days argument is ignored: 7 days returned ' || n);

  select paid_bookings into n from public.listing_performance(1)
   where title = 'Earning Club';
  perform assert(n = 0, 'a 1-day window still returns old bookings');

  -- Clamped, not trusted: a silly value must not error or return everything
  -- since the epoch.
  select paid_bookings into n from public.listing_performance(999999)
   where title = 'Earning Club';
  perform assert(n = 2, 'an out-of-range window broke the report');
  select paid_bookings into n from public.listing_performance(0)
   where title = 'Earning Club';
  perform assert(n = 0, 'zero days was not clamped to a 1-day window');
  select paid_bookings into n from public.listing_performance(null)
   where title = 'Earning Club';
  perform assert(n = 2, 'a null window broke the report');
end $$;

-- ── Every listing appears, earning or not ────────────────────────────────────
do $$
declare n integer;
begin
  select count(*) into n from public.listing_performance(365);
  perform assert(n = 4, 'the report dropped a listing: got ' || n || ' of 4');
  -- A LEFT JOIN, not an inner one. The listings with no bookings are the ones
  -- worth looking at.
  select count(*) into n from public.listing_performance(365) where paid_bookings = 0;
  perform assert(n = 3, 'listings with no bookings were dropped');
end $$;

-- ── The grant ────────────────────────────────────────────────────────────────
do $$
declare n integer;
begin
  -- This returns every host's revenue and every price. anon and authenticated
  -- must not be able to run it; partner_stats() draws the same line.
  select count(*) into n
    from information_schema.role_routine_grants
   where routine_name = 'listing_performance' and grantee in ('anon', 'authenticated', 'PUBLIC');
  perform assert(n = 0, 'listing_performance is executable by anon/authenticated/PUBLIC');

  select count(*) into n
    from information_schema.role_routine_grants
   where routine_name = 'listing_performance' and grantee = 'service_role';
  perform assert(n > 0, 'service_role cannot execute listing_performance');
end $$;

select 'listing_performance: all checks passed' as result;
