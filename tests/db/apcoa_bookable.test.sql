-- APCOA: what the publish migration refuses, and what it does once the facts land.
--
-- This runs against the REAL rental_listings — every constraint, every trigger,
-- all twenty-odd ALTERs — because the whole value of the file under test is
-- that it will not publish a listing the schema would reject. Tested against
-- the harness stub it would prove nothing at all.
\set ON_ERROR_STOP on
set client_min_messages = notice;

create or replace function assert(p_cond boolean, p_what text)
returns void language plpgsql as $$
begin
  if p_cond then raise notice '  PASS  %', p_what;
  else raise exception 'FAIL  %', p_what;
  end if;
end $$;

-- Runs the migration file's ACTUAL BYTES. psql's \i cannot be used inside a
-- plpgsql block — backslash commands are not read inside dollar quotes — and
-- pasting a copy of the logic into the test would only prove the copy works.
-- pg_read_file needs superuser, which the throwaway cluster's postgres is.
create or replace function run_file(p_path text) returns void
language plpgsql as $$
begin execute pg_read_file(p_path); end $$;

-- The two drafts as they stand today: surveyed pins, real bay counts, no price,
-- no photos, no access method. Exactly the state 20260817 left them in.
insert into public.rental_listings
  (id, title, address, owner_email, status, spaces, lat, lng, contact_phone)
values
  ('cc000000-0000-0000-0000-000000000001','Oxford Street (Hilton) Car Park — APCOA',
   'Oxford Street, Belfast','adam.richards@apcoa.com','draft',220,54.5983,-5.9225,''),
  ('cc000000-0000-0000-0000-000000000002','Lanyon Place Car Park — APCOA',
   '6 Lanyon Place, Belfast','adam.richards@apcoa.com','draft',570,54.5978,-5.9161,'');

\echo ''
\echo '1. As committed, it refuses — and says exactly what is missing'
do $$
declare msg text;
begin
  perform run_file('/tmp/pe-apcoa.sql');
  raise exception 'FAIL  the migration published APCOA with no access method';
exception when raise_exception then
  msg := sqlerrm;
  if msg like 'FAIL %' then raise; end if;
  perform assert(msg like '%access_method%',
    'the refusal names access_method — the ANPR problem, not a missing photo');
  perform assert(msg like '%parking charge notice%',
    'and says what happens to the driver if it is skipped');
  perform assert(msg like '%org_registration%' and msg like '%access_contact%',
    'and names the other facts APCOA has to supply');
  perform assert(msg like '%has 0 of the 5%',
    'and counts the photos rather than leaving somebody to find out at publish');
end $$;

select assert(
  (select count(*) from public.rental_listings where status = 'draft') = 2,
  'and nothing was published on the way to refusing');

\echo ''
\echo '2. Filling in only SOME of it still refuses'
-- The failure mode this guards against is somebody adding five photos, seeing
-- the photo complaint disappear, and assuming the job is done.
update public.rental_listings
   set photos = array['a','b','c','d','e'],
       instructions = 'Enter from the street, follow the signs to the visitor levels.'
 where owner_email = 'adam.richards@apcoa.com';
do $$
declare msg text;
begin
  perform run_file('/tmp/pe-apcoa.sql');
  raise exception 'FAIL  photos alone were enough to publish an ANPR car park';
exception when raise_exception then
  msg := sqlerrm;
  if msg like 'FAIL %' then raise; end if;
  perform assert(msg like '%access_method%', 'photos alone do not publish it');
  perform assert(msg not like '%of the 5%', 'and the photo complaint is gone, so the list is real');
end $$;

\echo ''
\echo '3. With the facts, it publishes — on the invoice model'
select run_file('/tmp/pe-apcoa-filled.sql');

select assert(
  (select count(*) from public.rental_listings
    where owner_email = 'adam.richards@apcoa.com' and status = 'active') = 2,
  'both sites are live');
select assert(
  (select count(*) from public.rental_listings
    where owner_email = 'adam.richards@apcoa.com' and payout_mode = 'invoice') = 2,
  'on the invoice model — no Connect account, so checkout will not 409');
select assert(
  (select count(distinct operator_share_pct) from public.rental_listings
    where owner_email = 'adam.richards@apcoa.com') = 1
  and (select max(operator_share_pct) from public.rental_listings
        where owner_email = 'adam.richards@apcoa.com') = 100,
  'ParkEasy claims none of APCOA''s tariff — no split has been agreed to claim');
select assert(
  (select price_per_hour from public.rental_listings
    where id = 'cc000000-0000-0000-0000-000000000001') = 4.10
  and (select price_per_hour from public.rental_listings
        where id = 'cc000000-0000-0000-0000-000000000002') = 4.70,
  'each site is priced at its own published APCOA tariff, not a shared guess');
select assert(
  (select bool_and(host_type = 'organization') from public.rental_listings
    where owner_email = 'adam.richards@apcoa.com'),
  'and as an organisation, so the five-photo and access-contact rules kept biting');

\echo ''
\echo '4. Running it twice changes nothing'
select run_file('/tmp/pe-apcoa-filled.sql');
select assert(
  (select count(*) from public.rental_listings
    where owner_email = 'adam.richards@apcoa.com' and status = 'active') = 2,
  'idempotent — a rerun does not duplicate, unpublish or re-price');

\echo ''
\echo '5. The service-role claim does not leak out of the migration'
-- The DO block grants itself the service role so it can set approved_by_founder,
-- which trg_guard_admin_columns otherwise refuses. If that claim survived the
-- block, every statement afterwards in the same session could approve listings.
select assert(
  coalesce(current_setting('request.jwt.claims', true), '') = '',
  'the session is back to no claims once the migration ends');

\echo ''
\echo 'ALL PASSED'
