-- A licence agreement is not a weekly pattern.
--
-- available_days answers "which weekdays", and that is all it can answer. The
-- Belfast Royal Academy agreement, signed 29 July 2026, says something a weekly
-- pattern cannot express:
--
--   cl.2  "This agreement runs from 2 August 2026 until ended by either party"
--         "the Academy may pause the listing or block out dates at any time"
--   cl.3  "8am to 5pm Monday to Friday, and 8am to 5pm on Saturday 8 August
--          2026 ... ParkEasy will not offer the Spaces for booking outside
--          these hours."
--         "Further dates, including Sunday 9 August 2026, may be added by
--          written agreement"
--
-- Encoded as available_days = {1..6} that reads as "every Saturday, forever",
-- which is four words of a signed contract away from what was agreed and would
-- have had us selling a locked car park on 15 August. So:
--
--   available_from  / available_until  — the term (cl.2)
--   extra_dates                        — one-off dates outside the weekly
--                                        pattern, i.e. Saturday 8 August, and
--                                        the mechanism for adding Sunday 9th
--   blocked_dates                      — the host's right to block out a date
--
-- Enforced in api/checkout/create-session.js and mirrored in the booking sheet
-- so a driver is told before they reach a card form, not after.

alter table public.rental_listings
  add column if not exists available_from  date,
  add column if not exists available_until date,
  add column if not exists extra_dates     date[] not null default '{}',
  add column if not exists blocked_dates   date[] not null default '{}';

comment on column public.rental_listings.available_from is
  'First date bookable. Null = no start bound. The term start in a licence agreement.';
comment on column public.rental_listings.available_until is
  'Last date bookable. Null = open-ended ("until ended by either party").';
comment on column public.rental_listings.extra_dates is
  'Specific dates bookable even when the weekday is not in available_days.';
comment on column public.rental_listings.blocked_dates is
  'Specific dates never bookable, whatever available_days and extra_dates say. Blocked wins.';

-- A window that ends before it starts silently makes a listing unbookable with
-- no error anywhere. Refuse it at write time instead.
alter table public.rental_listings
  drop constraint if exists rental_listings_date_window_sane;
alter table public.rental_listings
  add constraint rental_listings_date_window_sane check (
    available_from is null or available_until is null or available_until >= available_from
  );
