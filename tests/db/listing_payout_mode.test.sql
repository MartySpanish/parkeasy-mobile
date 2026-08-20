-- The invoice payout model: what a listing must declare, what a booking
-- remembers, and what ParkEasy is left owing.
--
-- These rules only ever matter with real money in the room. The whole point of
-- invoice mode is that Stripe does NOT move the operator's share for us, so the
-- only record of what APCOA is owed is arithmetic in a view. Arithmetic in a
-- view that nobody has run against a refund is a guess.
\set ON_ERROR_STOP on
set client_min_messages = notice;

create or replace function assert(p_cond boolean, p_what text)
returns void language plpgsql as $$
begin
  if p_cond then raise notice '  PASS  %', p_what;
  else raise exception 'FAIL  %', p_what;
  end if;
end $$;

insert into public.rental_listings (id, title, status) values
  ('aaaaaaaa-0000-0000-0000-000000000001','Belfast GAA club','active'),
  ('aaaaaaaa-0000-0000-0000-000000000002','Commercial multi-storey','active');

\echo ''
\echo '1. Connect is still the default, and nothing about it changed'
select assert(
  (select payout_mode from public.rental_listings
    where id = 'aaaaaaaa-0000-0000-0000-000000000001') = 'connect',
  'a listing created without saying anything is a Connect listing');
select assert(
  (select operator_share_pct from public.rental_listings
    where id = 'aaaaaaaa-0000-0000-0000-000000000001') is null,
  'and carries NO operator share — 85% is not a default anybody typed');

\echo ''
\echo '2. An invoice listing must say what the operator is owed'
-- Otherwise the money arrives in ParkEasy's balance and there is no record
-- anywhere of whose it is.
do $$ begin
  update public.rental_listings set payout_mode = 'invoice'
   where id = 'aaaaaaaa-0000-0000-0000-000000000002';
  raise exception 'FAIL  invoice mode was accepted with no operator share';
exception when check_violation then
  raise notice '  PASS  invoice mode with no share is refused';
end $$;

update public.rental_listings
   set payout_mode = 'invoice', operator_share_pct = 70
 where id = 'aaaaaaaa-0000-0000-0000-000000000002';
select assert(true, 'invoice mode with a share is accepted');

do $$ begin
  update public.rental_listings set operator_share_pct = 120
   where id = 'aaaaaaaa-0000-0000-0000-000000000002';
  raise exception 'FAIL  an operator share above 100%% was accepted';
exception when check_violation then
  raise notice '  PASS  a share above 100%% is refused';
end $$;

do $$ begin
  update public.rental_listings set payout_mode = 'whatever'
   where id = 'aaaaaaaa-0000-0000-0000-000000000001';
  raise exception 'FAIL  an unknown payout mode was accepted';
exception when check_violation then
  raise notice '  PASS  a payout mode that is neither connect nor invoice is refused';
end $$;

\echo ''
\echo '3. A booking remembers the model it was taken under'
-- Snapshotted, because a listing''s share is renegotiable and what was owed on
-- a booking already taken is not.
insert into public.bookings (id, listing_id, amount_total_pence, booking_price_pence,
                             application_fee_pence, service_fee_pence, status)
values ('bbbbbbbb-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001',
        2300, 2000, 600, 300, 'paid');
select assert(
  (select payout_mode from public.bookings
    where id = 'bbbbbbbb-0000-0000-0000-000000000001') = 'connect',
  'an ordinary booking is a connect booking');
select assert(
  (select operator_share_pence from public.bookings
    where id = 'bbbbbbbb-0000-0000-0000-000000000001') = 0,
  'and owes an operator nothing — Stripe already moved the host their 85%');

\echo ''
\echo '4. What ParkEasy owes, and what it does not'
-- £20 space + £3 driver fee. 70% of the space price is £14 to the operator.
insert into public.bookings (id, listing_id, amount_total_pence, booking_price_pence,
                             application_fee_pence, service_fee_pence, status,
                             payout_mode, operator_share_pence)
values ('bbbbbbbb-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000002',
        2300, 2000, 900, 300, 'paid', 'invoice', 1400);

select assert(
  (select count(*) from public.booking_settlements
    where listing_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 0,
  'a connect booking never appears on the settlement list');
select assert(
  (select operator_share_due_pence from public.booking_settlements
    where listing_id = 'aaaaaaaa-0000-0000-0000-000000000002') = 1400,
  'an invoice booking owes the operator their share');
select assert(
  (select parkeasy_net_pence from public.booking_settlements
    where listing_id = 'aaaaaaaa-0000-0000-0000-000000000002') = 900,
  'and ParkEasy is left with the rest — the commission and the driver fee');

\echo ''
\echo '5. A pending booking is not money'
insert into public.bookings (id, listing_id, amount_total_pence, booking_price_pence,
                             application_fee_pence, service_fee_pence, status,
                             payout_mode, operator_share_pence)
values ('bbbbbbbb-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000002',
        2300, 2000, 900, 300, 'pending', 'invoice', 1400);
select assert(
  (select operator_share_due_pence from public.booking_settlements
    where listing_id = 'aaaaaaaa-0000-0000-0000-000000000002') = 1400,
  'a checkout somebody abandoned owes the operator nothing');

\echo ''
\echo '6. Refunds — the part that is easy to get silently wrong'
-- THE BUG THIS EXISTS TO CATCH. The first version of this view filtered on
-- status = 'paid'. Every late cancellation and every no-show — the bookings
-- where the driver got NOTHING back and ParkEasy kept the lot — would have
-- vanished off the settlement list, and the operator would simply never have
-- been paid for them. A Connect host keeps their 85% on exactly those
-- bookings, automatically, and would never have noticed the difference.
insert into public.bookings (id, listing_id, amount_total_pence, booking_price_pence,
                             application_fee_pence, service_fee_pence, status,
                             payout_mode, operator_share_pence, refund_pence, refund_status)
values ('bbbbbbbb-0000-0000-0000-000000000004','aaaaaaaa-0000-0000-0000-000000000002',
        2300, 2000, 900, 300, 'cancelled', 'invoice', 1400, 0, 'denied_late');
select assert(
  (select operator_share_due_pence from public.booking_settlements
    where listing_id = 'aaaaaaaa-0000-0000-0000-000000000002') = 2800,
  'a late cancellation still owes the operator in full — the space was held');

-- Cancelled in time: the whole £20 space price back. The £3 driver fee is ours
-- and is not refunded, so the operator's £14 goes to nothing and ParkEasy is
-- left with its fee.
insert into public.bookings (id, listing_id, amount_total_pence, booking_price_pence,
                             application_fee_pence, service_fee_pence, status,
                             payout_mode, operator_share_pence, refund_pence, refund_status)
values ('bbbbbbbb-0000-0000-0000-000000000005','aaaaaaaa-0000-0000-0000-000000000002',
        2300, 2000, 900, 300, 'cancelled', 'invoice', 1400, 2000, 'refunded');
select assert(
  (select operator_share_due_pence from public.booking_settlements
    where listing_id = 'aaaaaaaa-0000-0000-0000-000000000002') = 2800,
  'a fully refunded booking owes the operator nothing');

-- Half the space price back. The operator's share halves with it, and neither
-- side eats the whole refund.
insert into public.bookings (id, listing_id, amount_total_pence, booking_price_pence,
                             application_fee_pence, service_fee_pence, status,
                             payout_mode, operator_share_pence, refund_pence, refund_status)
values ('bbbbbbbb-0000-0000-0000-000000000006','aaaaaaaa-0000-0000-0000-000000000002',
        2300, 2000, 900, 300, 'cancelled', 'invoice', 1400, 1000, 'partial');
select assert(
  (select operator_share_due_pence from public.booking_settlements
    where listing_id = 'aaaaaaaa-0000-0000-0000-000000000002') = 3500,
  'a half refund halves what the operator is owed, and no more');

\echo ''
\echo '7. The surcharge is the operator''s, and a refund hands it back'
-- £20 space + £10 overnight fee, none of which we keep at this site. The
-- operator is owed £14 + £10 = £24. Refunded in full (space + surcharge, the
-- driver fee retained) → nothing owed.
insert into public.bookings (id, listing_id, amount_total_pence, booking_price_pence,
                             application_fee_pence, service_fee_pence, surcharge_pence,
                             status, payout_mode, operator_share_pence, refund_pence, refund_status)
values ('bbbbbbbb-0000-0000-0000-000000000007','aaaaaaaa-0000-0000-0000-000000000002',
        3300, 2000, 900, 300, 1000, 'cancelled', 'invoice', 2400, 3000, 'refunded');
select assert(
  (select operator_share_due_pence from public.booking_settlements
    where listing_id = 'aaaaaaaa-0000-0000-0000-000000000002') = 3500,
  'a refund covering the space AND the overnight fee leaves the operator owed nothing');
select assert(
  (select refunded_pence from public.booking_settlements
    where listing_id = 'aaaaaaaa-0000-0000-0000-000000000002') = 6000,
  'and the refunds are shown, not just netted off, so the figure can be checked');

\echo ''
\echo 'ALL PASSED'
