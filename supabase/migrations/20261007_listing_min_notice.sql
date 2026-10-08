-- How much warning a host needs before a booking starts.
--
-- WHY. On 7 August two drivers paid for Michael Davitt GAC and on the 8th found
-- the gates locked: the slots were sold with thirteen hours' notice on a Friday
-- night. They are the only two real bookings ParkEasy has ever taken. Checkout
-- validated the date against available_days, extra_dates, blocked_dates,
-- available_from/until, capacity and overlaps, and never against how soon the
-- slot started.
--
-- DEFAULT 0, DELIBERATELY. Zero means "no requirement", which is exactly what
-- every listing has had until now, so applying this migration changes no
-- listing's behaviour. A space only gains a notice period when somebody sets a
-- number against it. That makes this safe to apply before the UI exists to
-- edit it, and impossible for it to take a space off sale by surprise.
--
-- The ceiling is two weeks. A longer requirement is a site that should be
-- listed with an availability window instead, not a notice period.
alter table public.rental_listings
  add column if not exists min_notice_hours integer not null default 0;

alter table public.rental_listings
  drop constraint if exists rental_listings_min_notice_hours_range;

alter table public.rental_listings
  add constraint rental_listings_min_notice_hours_range
  check (min_notice_hours >= 0 and min_notice_hours <= 336);

comment on column public.rental_listings.min_notice_hours is
  'Hours of warning this host needs before a booking starts. 0 = book any time. '
  'Enforced in api/checkout/create-session.js via src/data/bookingLeadTime.js.';

-- The one listing we know was burned by having no notice period. A volunteer
-- committee checking email in the evening needs a day, not an afternoon.
--
-- Matched on the title rather than a pasted uuid so this file is readable and
-- so it is a no-op on any database that does not have that listing (a test
-- cluster, a fresh project). It is NOT a blanket update: every other listing
-- keeps 0 until somebody decides otherwise.
update public.rental_listings
   set min_notice_hours = 24
 where title = 'Michael Davitt GAC — Davitt Park'
   and min_notice_hours = 0;
