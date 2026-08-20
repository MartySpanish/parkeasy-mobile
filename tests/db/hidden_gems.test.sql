-- hidden_gems: the gate, the join, and the private-land rule.
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
  ('11111111-1111-1111-1111-111111111111','payer@example.test'),
  ('22222222-2222-2222-2222-222222222222','freeloader@example.test'),
  ('33333333-3333-3333-3333-333333333333','emailonly@example.test');

-- One subscriber by user_id, one by email only (a Stripe payment-link buyer
-- whose auth account was never linked — there is one of these live), and one
-- with an EXPIRED code who must be treated as a free user.
insert into public.promo_redemptions (user_id, user_email, code, expires_at) values
  ('11111111-1111-1111-1111-111111111111','payer@example.test','STRIPE-SUB', now() + interval '30 days'),
  (null,                                  'emailonly@example.test','STRIPE-SUB', now() + interval '30 days'),
  ('22222222-2222-2222-2222-222222222222','freeloader@example.test','PARKEZ', now() - interval '1 day');

insert into public.rental_listings (id, title, lat, lng, status)
values ('aaaaaaaa-0000-0000-0000-000000000001','Davitt Park', 54.58, -5.99, 'active');

insert into public.hidden_gems (legacy_id, name, near, restriction, notes, lat, lng, land_type, status, town, tags)
values
  ('66','LORAG centre kerbside','Ormeau','Free — no restrictions','Quiet after 6pm', 54.5800, -5.9200, 'public','published','belfast', array['lorag','lower ormeau','gasworks']::text[]),
  ('36','Ormeau Embankment riverside','Ormeau','Free all day', null, 54.5810, -5.9210, 'public','published','belfast', array['ormeau embankment','lagan']::text[]),
  ('568','Tesco Extra Car Park','Castle Mall','Free, customers only', null, 54.7200, -6.2100, 'private','draft','antrim', array['tesco','castle way']::text[]);

--------------------------------------------------------------------------------
\echo ''
\echo '1. A published gem must have restrictions and must not be private land'
--------------------------------------------------------------------------------
do $$ begin
  insert into public.hidden_gems (legacy_id, name, restriction, lat, lng, status)
  values ('9001','No restrictions given','  ', 54.6, -5.9, 'published');
  raise exception 'FAIL  a gem was published with no restrictions';
exception when check_violation then
  raise notice '  PASS  publishing without restrictions is refused';
end $$;

do $$ begin
  insert into public.hidden_gems (legacy_id, name, restriction, lat, lng, land_type, status)
  values ('9002','Somebody else''s car park','Free, customers only', 54.6, -5.9, 'private', 'published');
  raise exception 'FAIL  a private-land gem was published with nobody signing it off';
exception when check_violation then
  raise notice '  PASS  private land cannot be published by default';
end $$;

do $$ begin
  update public.hidden_gems set status = 'published' where legacy_id = '568';
  raise exception 'FAIL  the Tesco draft was promoted with nobody signing it off';
exception when check_violation then
  raise notice '  PASS  nor by promoting an existing draft';
end $$;

-- THE OVERRIDE IS A SIGNATURE, NOT A DELETED RULE. Marty's call was to publish
-- the five retail-land gems that have been live for months. Dropping the
-- constraint would have honoured that and left the NEXT private car park
-- somebody submits publishable by accident.
update public.hidden_gems
   set private_land_approved_by = 'Marty Rooney, 19 Aug 2026', status = 'published'
 where legacy_id = '568';
select assert(
  (select status from public.hidden_gems where legacy_id='568') = 'published',
  'but private land CAN be published once somebody has signed it off');
select assert(
  (select private_land_approved_by from public.hidden_gems where legacy_id='568') is not null,
  'and the sign-off is recorded against the row, not lost in a chat');

do $$ begin
  update public.hidden_gems set private_land_approved_by = null where legacy_id = '568';
  raise exception 'FAIL  the sign-off was removed from a published private-land gem';
exception when check_violation then
  raise notice '  PASS  and it cannot be withdrawn while the gem is still published';
end $$;

--------------------------------------------------------------------------------
\echo ''
\echo '2. resolve_spot bridges free and paid, and admits what it does not know'
--------------------------------------------------------------------------------
select assert((select kind from public.resolve_spot('66')) = 'gem',            'an integer id resolves to a gem');
select assert((select name from public.resolve_spot('66')) = 'LORAG centre kerbside', 'and carries the gem back');
select assert((select kind from public.resolve_spot('rental-aaaaaaaa-0000-0000-0000-000000000001')) = 'listing',
  'a rental- prefix resolves to a listing');
select assert((select name from public.resolve_spot('rental-aaaaaaaa-0000-0000-0000-000000000001')) = 'Davitt Park',
  'and carries the listing back');
-- The case the brief did not expect: ids 25, 43, 16 and 26 are live in
-- spot_occupancy and are NOT gems — they are free, timed and official spots
-- still in app code. They must not silently vanish from a join.
select assert((select kind from public.resolve_spot('25')) = 'legacy_spot',
  'an id that is not a gem returns legacy_spot, not null');
select assert((select kind from public.resolve_spot('rental-aaaaaaaa-9999-9999-9999-999999999999')) = 'unknown',
  'a rental id for a listing that is gone returns unknown');
select assert((select count(*) from public.resolve_spot(null)) = 0, 'a null id returns no rows');

--------------------------------------------------------------------------------
\echo ''
\echo '3. The Premium gate — the first time it has actually existed'
--------------------------------------------------------------------------------
grant usage on schema public to anon, authenticated;

-- A paying subscriber, matched by user_id.
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111', false);
select set_config('request.jwt.claims','{"sub":"11111111-1111-1111-1111-111111111111","email":"payer@example.test"}', false);
select assert(public.has_premium(), 'a live STRIPE-SUB row is Premium');
select assert((select count(*) from public.hidden_gems) = 3, 'and sees the published gems');

-- The payment-link buyer with no user_id, matched on email.
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333', false);
select set_config('request.jwt.claims','{"sub":"33333333-3333-3333-3333-333333333333","email":"emailonly@example.test"}', false);
select assert(public.has_premium(), 'a subscriber with no user_id is still Premium, matched on email');
select assert((select count(*) from public.hidden_gems) = 3, 'and sees the gems');

-- Expired code: a free user.
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222', false);
select set_config('request.jwt.claims','{"sub":"22222222-2222-2222-2222-222222222222","email":"freeloader@example.test"}', false);
select assert(not public.has_premium(), 'an expired code is not Premium');
select assert((select count(*) from public.hidden_gems) = 0,
  'and a free user sees NO gem rows at all — not even to hide in the UI');

-- The teaser is what a free user gets instead.
select assert((select count(*) from public.hidden_gems_teaser) = 3,
  'a free user still sees the teasers');
select assert(
  (select approx_lat from public.hidden_gems_teaser where legacy_id='66') = 54.580,
  'with the coordinate snapped to the ~500m grid');
select assert(
  (select approx_lat from public.hidden_gems_teaser where legacy_id='36') = 54.580,
  'so two gems 100m apart snap to the same pin');

reset role;
-- The columns exist because a TASTER carries its real detail — it is given away
-- on purpose. What matters is what a non-taster row actually contains, so this
-- tests the values rather than the schema. (An earlier version asserted the
-- columns were absent and started failing the moment tasters were added, which
-- would have been a green light to weaken the check instead of the right one.)
select assert(
  (select count(*) from public.hidden_gems_teaser
    where not is_taster and (name is not null or notes is not null or restriction is not null)) = 0,
  'a non-taster teaser carries no name, notes or restriction');
-- Tags ARE carried, for everyone. Withholding them cost 30 of the 84 gems their
-- findability, and a gem a free user cannot search for never shows the locked
-- card that sells Premium. They are matched against and never rendered.
select assert(
  (select cardinality(tags) from public.hidden_gems_teaser where legacy_id = '66') > 0,
  'a non-taster teaser DOES carry its tags, so it stays searchable');
select assert(not exists (
  select 1 from information_schema.columns
   where table_name='hidden_gems_teaser' and column_name in ('photo_url','lat','lng')),
  'and the exact coordinate and photo are not columns of the view at all');

select assert(not has_table_privilege('anon','public.hidden_gems','select'),
  'anon cannot read the gem table at all');
select assert(has_table_privilege('anon','public.hidden_gems_teaser','select'),
  'but can read the teaser');
select assert(has_table_privilege('anon','public.hidden_gem_stats','select'),
  'and the public count');
select assert(not has_table_privilege('authenticated','public.hidden_gems','insert'),
  'nobody writes a gem from the browser');

--------------------------------------------------------------------------------
\echo ''
\echo '4. The public count'
--------------------------------------------------------------------------------
select assert((select published from public.hidden_gem_stats) = 3, 'counts published gems only');
select assert((select towns from public.hidden_gem_stats) = 2, 'and the towns they are in');

\echo ''
\echo 'ALL CHECKS PASSED'
