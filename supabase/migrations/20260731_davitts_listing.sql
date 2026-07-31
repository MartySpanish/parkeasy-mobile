-- Michael Davitt GAC (Davitt Park, Clowney Street, Belfast) — 15 spaces,
-- £20 per vehicle per day, gates 9am–8.30pm, £20 if a car is left in.
--
-- Written as a migration because the Supabase connector was down when this was
-- built. Applying it is idempotent: it keys on the address, so re-running it
-- updates the row rather than creating a second listing.
--
-- TWO THINGS TO CHECK BEFORE THIS GOES LIVE — both are marked below:
--
--   1. lat/lng are an ESTIMATE. Every geocoder was blocked from the build
--      environment, so these are placed from the address (Davitt Park, Clowney
--      Street, BT12 7) rather than resolved. A wrong pin sends a driver who has
--      paid £20 to the wrong street. Drop a pin on the actual car park entrance
--      and update these before approving.
--
--   2. owner_email decides WHO gets the money. /api/listings/claim attaches this
--      listing to the first confirmed account matching this address, and
--      /api/checkout/create-session pays out to that account's Stripe. The
--      address below is the club secretary's, published on antrim.gaa.ie —
--      change it to whoever is actually setting up payouts before sending the
--      link, or their sign-up won't pick the listing up.
--
-- Status stays 'draft' until the agreement is signed. It moves to
-- 'pending_approval' then, which puts it in the founder review queue.

insert into public.rental_listings (
  title, description, address, lat, lng,
  space_type, host_type, org_name, org_type,
  spaces, price_per_hour, price_per_day,
  gate_opens_at, gate_closes_at, overnight_fee_pence,
  available_days, availability,
  contact_email, contact_phone, owner_email,
  access_contact_name, access_contact_phone, access_method,
  instructions, photos, status
) values (
  'Michael Davitt GAC — Davitt Park',
  'Parking at Davitt Park, the Michael Davitt GAC grounds off the Falls Road in West Belfast — about 25 minutes'' walk from the city centre, or a short bus ride. 15 marked spaces in a modern, gated, floodlit car park. Access is 9am to 8.30pm on the day you book; the gates are locked outside those hours.',
  'Davitt Park, Clowney Street, Belfast BT12',
  54.5875,   -- ESTIMATE — confirm against the real car park entrance
  -5.9625,   -- ESTIMATE — confirm against the real car park entrance
  'car_park', 'organization', 'Michael Davitt GAC', 'sports club',
  15,
  null,      -- no hourly rate: a day rate is what the club agreed, and £20/9.5h
             -- would let someone take a space for two hours at £4.20
  20.00,
  '09:00', '20:30', 2000,
  array[1,2,3,4,5,6,7],   -- open every day; the club blocks out match and
                          -- training dates via blocked_dates (cl.3)
  'Always',
  'secretary.michaeldavitts.antrim@gaa.ie',   -- CHANGE to the real contact
  '028 9032 8004',
  'secretary.michaeldavitts.antrim@gaa.ie',   -- CHANGE — this decides who is paid
  'Michael Davitt GAC', '028 9032 8004',
  'Drive in through the main gates on Clowney Street and park in a marked bay in the car park. Do not drive onto any pitch or playing surface, do not block the gates or any access route, and please do not go into any other part of the grounds or the club buildings. Gates are open 9am to 8.30pm; a car left in after 8.30pm is locked in overnight and incurs a £20 fee, which goes to the club.',
  'Drive in through the main gates on Clowney Street and park in a marked bay. Do not drive onto any pitch or playing surface, do not block the gates or any access route, and please do not go into any other part of the grounds or the club buildings. Gates are open 9am to 8.30pm; anything left in after 8.30pm is locked in overnight and incurs a £20 fee, which goes to the club in full.',
  '{}',      -- photos to come from the club; publish_photos needs 2 for an org
  'draft'
)
on conflict do nothing;

-- Re-runnable: if the row already exists, bring the commercial terms back in
-- line with the signed agreement rather than leaving a stale copy.
update public.rental_listings set
  spaces = 15,
  price_per_hour = null,
  price_per_day = 20.00,
  gate_opens_at = '09:00',
  gate_closes_at = '20:30',
  overnight_fee_pence = 2000,
  available_days = array[1,2,3,4,5,6,7]
where address = 'Davitt Park, Clowney Street, Belfast BT12'
  and org_name = 'Michael Davitt GAC';
