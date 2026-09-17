-- Which hotspots produce bookings — and the row that matters most.
--
-- A gem with taps and NO bookings is the interesting one: the card is being
-- read and the paid space is not being bought, which is either the wrong
-- alternative or the wrong price. Either inner join hides it, so most of these
-- checks are about it surviving.
\set ON_ERROR_STOP on
set client_min_messages = notice;

create or replace function assert(p_cond boolean, p_what text)
returns void language plpgsql as $$
begin
  if p_cond then raise notice '  PASS  %', p_what;
  else raise exception 'FAIL  %', p_what;
  end if;
end $$;

create or replace function stat(p_spot text, p_key text, p_days integer default 90)
returns text language sql as $$
  select r ->> p_key from jsonb_array_elements(public.hotspot_conversion_stats(p_days)) r
   where r ->> 'spot_id' = p_spot;
$$;

insert into public.hidden_gems (legacy_id, name, near, town, lat, lng, status, restriction) values
  ('101', 'Ormeau Embankment', 'Ormeau Rd', 'belfast', 54.58, -5.92, 'published', 'Free'),
  ('102', 'Cave Hill',         'Antrim Rd', 'belfast', 54.63, -5.96, 'published', 'Free');

insert into public.rental_listings (id, title, address, lat, lng, status, price_per_day)
values ('44444444-0000-0000-0000-000000000001', 'A club car park', 'Belfast', 54.58, -5.93, 'active', 20);

-- Ormeau: 3 taps from 2 sessions, and 2 paid bookings worth £25 total.
insert into public.app_events (event_name, session_id, props) values
  ('hotspot_to_booking_tap', 'aaaaaaaa-0000-0000-0000-000000000001', '{"spot":"101"}'),
  ('hotspot_to_booking_tap', 'aaaaaaaa-0000-0000-0000-000000000001', '{"spot":"101"}'),
  ('hotspot_to_booking_tap', 'aaaaaaaa-0000-0000-0000-000000000002', '{"spot":"101"}'),
  -- Cave Hill: tapped once, never booked. THE ROW THAT MATTERS.
  ('hotspot_to_booking_tap', 'aaaaaaaa-0000-0000-0000-000000000003', '{"spot":"102"}');

insert into public.bookings
  (listing_id, driver_email, amount_total_pence, booking_price_pence, application_fee_pence,
   service_fee_pence, status, from_hotspot, from_hotspot_spot_id) values
  ('44444444-0000-0000-0000-000000000001', 'd1@test.local', 1500, 1200, 180, 300, 'paid',      true, '101'),
  ('44444444-0000-0000-0000-000000000001', 'd2@test.local', 1000, 800,  120, 200, 'paid',      true, '101'),
  -- Not paid: must not be counted as a conversion.
  ('44444444-0000-0000-0000-000000000001', 'd3@test.local', 1000, 800,  120, 200, 'cancelled', true, '101'),
  -- A booking from a spot nobody tapped through app_events (event lost).
  ('44444444-0000-0000-0000-000000000001', 'd4@test.local', 2000, 1600, 240, 400, 'paid',      true, '999');

--------------------------------------------------------------------------------
\echo ''
\echo '1. Taps and bookings, per hotspot'
--------------------------------------------------------------------------------
select assert(stat('101', 'taps')::int = 3, 'Ormeau counts 3 taps');
select assert(stat('101', 'tap_sessions')::int = 2, 'from 2 sessions — a double tap is one person');
select assert(stat('101', 'bookings')::int = 2, 'and 2 paid bookings');
select assert(stat('101', 'gross_pence')::int = 2500, 'worth £25 gross');
select assert(stat('101', 'name') = 'Ormeau Embankment', 'the gem is named, not just its id');
select assert(stat('101', 'is_gem')::boolean, 'and flagged as a gem');

--------------------------------------------------------------------------------
\echo ''
\echo '2. Only PAID bookings count as conversions'
--------------------------------------------------------------------------------
-- A cancelled booking is not a conversion. Counting it would flatter exactly
-- the number this exists to measure.
select assert(stat('101', 'bookings')::int = 2,
  'the cancelled booking is not counted — 3 rows exist for this spot');

--------------------------------------------------------------------------------
\echo ''
\echo '3. THE ROW THAT MATTERS: tapped, never booked'
--------------------------------------------------------------------------------
select assert(stat('102', 'taps')::int = 1, 'Cave Hill counts its tap');
select assert(stat('102', 'bookings')::int = 0, 'and zero bookings');
select assert(stat('102', 'name') = 'Cave Hill',
  'a hotspot that converts nobody is still listed — that is the one to look at');

--------------------------------------------------------------------------------
\echo ''
\echo '4. And the reverse: booked with no tap event recorded'
--------------------------------------------------------------------------------
-- A client event can be lost; the booking cannot. The server-side column is
-- the authoritative side, so a booking with no matching tap must still appear.
select assert(stat('999', 'bookings')::int = 1,
  'a booking whose tap event was lost is still counted');
select assert(stat('999', 'taps')::int = 0, 'with zero taps');
select assert(stat('999', 'name') = '999',
  'a spot with no gem row shows its id rather than a blank');
select assert(stat('999', 'is_gem')::boolean = false, 'and is not claimed to be a gem');

--------------------------------------------------------------------------------
\echo ''
\echo '5. The window, and who can read it'
--------------------------------------------------------------------------------
update public.app_events set created_at = now() - interval '200 days' where props ->> 'spot' = '102';
select assert(stat('102', 'taps', 90) is null, 'a tap outside the window drops out');
select assert(stat('102', 'taps', 365)::int = 1, 'and comes back when the window widens');

grant usage on schema public to anon;
select assert(not has_function_privilege('anon', 'public.hotspot_conversion_stats(integer)', 'execute'),
  'anon cannot read the conversion data');
select assert(has_function_privilege('service_role', 'public.hotspot_conversion_stats(integer)', 'execute'),
  'service_role can');

\echo ''
\echo 'hotspot conversion: all checks passed'
