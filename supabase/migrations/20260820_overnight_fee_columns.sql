-- Two columns the application has been reading and writing for weeks, and that
-- no migration in this repo has ever created.
--
-- FOUND while adding the invoice payout model, because its settlement view has
-- to know what part of a booking was a surcharge. bookings.surcharge_pence is
-- written by checkout/create-session.js on every booking and read by
-- bookings/cancel.js to decide a refund; rental_listings
-- .overnight_fee_commission_rate is what _pricing.js reads to work out how much
-- of an overnight fee we may keep — and Belfast Royal Academy's clause 5 says
-- we may keep none of it, so a rebuild that dropped this column would start
-- taking 15% of a fee a signed agreement says goes to the Academy in full.
--
-- They exist in production, applied by hand and never written down. This is the
-- FOURTH and FIFTH instance of that after spot_submissions.photo_url, the nine
-- columns missing from listings_public and promo_redemptions.user_id — see
-- tests/db/known-drift.sql. Those three are still only recorded as debt; these
-- two get a real migration instead, because a view in the same commit depends
-- on one of them and a test chain that cannot build the column cannot test it.
--
-- `if not exists` throughout, so applying this to production is a no-op that
-- changes nothing and simply makes the repo able to rebuild the database.

alter table public.bookings
  add column if not exists surcharge_pence integer not null default 0;

comment on column public.bookings.surcharge_pence is
  'The overnight lock-in fee charged on this booking, in pence. Inside '
  'amount_total_pence but NOT ours — it belongs to the site, less whatever '
  'share that site''s agreement allows us. Refunded to the driver on a '
  'cancellation: they never left a car in overnight.';

alter table public.rental_listings
  add column if not exists overnight_fee_commission_rate numeric(4,3) not null default 0
    check (overnight_fee_commission_rate >= 0 and overnight_fee_commission_rate <= 0.3);

comment on column public.rental_listings.overnight_fee_commission_rate is
  'Share of this site''s overnight fee that ParkEasy keeps. A TERM OF THE '
  'SIGNED AGREEMENT, per site, never assumed: Belfast Royal Academy''s clause 5 '
  'says the fee is paid to the Academy in full, so their rate is 0. Newer '
  'agreements are written at 0.15. Defaults to 0 — underclaiming our own '
  'commission costs us money, overclaiming breaks a contract.';
