-- listing_publish_readiness: does it name every blocker, and only the real ones?
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
  ('11111111-1111-1111-1111-111111111111','adam.richards@apcoa.test'),
  ('22222222-2222-2222-2222-222222222222','club@example.test');

-- APCOA Lanyon Place, exactly as it sits in production today: coordinates and a
-- bay count, and nothing else that publishing needs.
insert into public.rental_listings
  (id, owner_id, title, address, lat, lng, spaces, host_type, status)
values
  ('aaaaaaaa-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111',
   'Lanyon Place Car Park (APCOA)','Lanyon Place, Belfast', 54.5978, -5.9161, 570,
   'organization','draft');

\echo ''
\echo '1. It names what is actually missing'
select assert(
  (select cardinality(missing) from public.listing_publish_readiness
    where id='aaaaaaaa-0000-0000-0000-000000000001') >= 10,
  'a bare organisation draft fails ten or more requirements');
select assert(
  (select 'a price — no rate has been agreed' = any(missing) from public.listing_publish_readiness
    where id='aaaaaaaa-0000-0000-0000-000000000001'),
  'and the missing price is named in words, not as a constraint name');
select assert(
  (select 'founder approval' = any(missing) from public.listing_publish_readiness
    where id='aaaaaaaa-0000-0000-0000-000000000001'),
  'founder approval is listed like everything else');
select assert(
  (select not ('coordinates' = any(missing)) from public.listing_publish_readiness
    where id='aaaaaaaa-0000-0000-0000-000000000001'),
  'and what IS present is not reported as missing');

\echo ''
\echo '2. The payout check, which is not a constraint and bites last'
select assert(
  (select can_be_paid_out = false from public.listing_publish_readiness
    where id='aaaaaaaa-0000-0000-0000-000000000001'),
  'a host with no Stripe account cannot be paid');
insert into public.host_accounts (host_id, stripe_account_id, transfers_active)
values ('11111111-1111-1111-1111-111111111111','acct_test', true);
select assert(
  (select can_be_paid_out = true from public.listing_publish_readiness
    where id='aaaaaaaa-0000-0000-0000-000000000001'),
  'and can once they onboard');

\echo ''
\echo '3. A complete listing reports nothing missing — and then really publishes'
insert into public.rental_listings
  (id, owner_id, title, address, lat, lng, spaces, host_type, status,
   instructions, photos, contact_phone, availability, price_per_day,
   org_name, org_type, org_registration, access_contact_name, access_contact_phone,
   access_method, approved_by_founder)
values
  ('bbbbbbbb-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222',
   'A club that has sent everything','Somewhere, Belfast', 54.58, -5.99, 40,
   'organization','draft',
   'Come in the main gate off the road and park on the tarmac to the left.',
   array['a','b','c','d','e'], '02890000000','Event dates only', 20.00,
   'Example GAC','sports club','NI000000','A Steward','02890000001',
   'The steward opens the gate from an hour before and stays until the last car leaves.',
   true);

select assert(
  (select cardinality(missing) from public.listing_publish_readiness
    where id='bbbbbbbb-0000-0000-0000-000000000001') = 0,
  'a complete listing reports nothing missing');

-- The real test of the view: if it says nothing is missing, the update must work.
-- A readiness check that disagrees with the constraints is worse than none.
update public.rental_listings set status='active'
 where id='bbbbbbbb-0000-0000-0000-000000000001';
select assert(
  (select status from public.rental_listings where id='bbbbbbbb-0000-0000-0000-000000000001') = 'active',
  'and it genuinely publishes — the view agrees with the constraints');

\echo ''
\echo '4. And the APCOA row still cannot be published'
do $$ begin
  update public.rental_listings set status='active'
   where id='aaaaaaaa-0000-0000-0000-000000000001';
  raise exception 'FAIL  the APCOA draft published with no price and no access details';
exception when check_violation then
  raise notice '  PASS  the APCOA draft is refused by the database, as designed';
end $$;

\echo ''
\echo 'ALL CHECKS PASSED'
