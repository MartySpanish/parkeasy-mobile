-- QR codes: half the print run pointed at a page that does not exist.
\set ON_ERROR_STOP on
set client_min_messages = notice;

create or replace function assert(p_cond boolean, p_what text)
returns void language plpgsql as $$
begin
  if p_cond then raise notice '  PASS  %', p_what;
  else raise exception 'FAIL  %', p_what;
  end if;
end $$;

--------------------------------------------------------------------------------
\echo ''
\echo '1. The host-recruitment run now lands on a page that exists'
--------------------------------------------------------------------------------
-- Eleven codes in production — GAA clubs, churches, libraries, leisure centres,
-- Men's Sheds, driveway flyers — were landing a club treasurer on the DRIVER
-- homepage instead of the page asking him to list his car park.
select assert((select lands_on from public.qr_codes where code = 'gaa') = '/hosts?src=gaa',
  'a /host code was repointed at /hosts');
select assert((select lands_on from public.qr_codes where code = 'ch') = '/hosts?src=ch',
  'and so was the churches one');
select assert((select count(*) from public.qr_codes where lands_on like '/host?%') = 0,
  'no code still points at /host');

-- The src parameter survives the fix, or the whole run stops being attributable.
select assert((select lands_on from public.qr_codes where code = 'gaa') like '%src=gaa',
  'the src tag survived the rewrite');

-- Untouched: a working target, and one that is a marketing decision rather
-- than a typo.
select assert((select lands_on from public.qr_codes where code = 'fl') = '/belfast?src=fl',
  'a working /belfast code was left alone');
-- The fleadh codes are at taxi dispatch desks and hotel front desks: people
-- who want to know where to PARK. There is no /fleadh page and the event is
-- over, so they join the driver-facing run rather than pointing at nothing.
select assert((select lands_on from public.qr_codes where code = 'cab') = '/belfast?src=cab',
  'a /fleadh code was repointed at /belfast');
select assert((select count(*) from public.qr_codes where lands_on like '/fleadh?%') = 0,
  'no code still points at /fleadh');
select assert((select count(*) from public.qr_codes
                where split_part(lands_on, '?', 1) not in ('/belfast', '/hosts', '/')) = 0,
  'every code lands on a path this site actually serves');

--------------------------------------------------------------------------------
\echo ''
\echo '2. The admin view'
--------------------------------------------------------------------------------
select assert((select (r->>'scans')::int from jsonb_array_elements(public.qr_scan_stats(90)) r
                where r->>'code' = 'fl') = 3,
  'a code counts its scans in the window');
select assert((select (r->>'this_week')::int from jsonb_array_elements(public.qr_scan_stats(90)) r
                where r->>'code' = 'fl') = 2,
  'and separates out this week');
select assert((select (r->>'scans')::int from jsonb_array_elements(public.qr_scan_stats(7)) r
                where r->>'code' = 'fl') = 2,
  'narrowing the window drops the older scan');

-- THE ROW THAT MATTERS. A code with no scans is the sticker that is not
-- working, or was never put up. An inner join hides exactly that one.
select assert(exists (select 1 from jsonb_array_elements(public.qr_scan_stats(90)) r
                where r->>'code' = 'ch'),
  'a code with no scans at all is still listed');
select assert((select (r->>'scans')::int from jsonb_array_elements(public.qr_scan_stats(90)) r
                where r->>'code' = 'ch') = 0,
  'and shows zero rather than being absent');

select assert((select r->>'lands_on' from jsonb_array_elements(public.qr_scan_stats(90)) r
                where r->>'code' = 'gaa') = '/hosts?src=gaa',
  'the stats carry lands_on, so a wrong target is visible on the same screen');

--------------------------------------------------------------------------------
\echo ''
\echo '3. Who can read it'
--------------------------------------------------------------------------------
grant usage on schema public to anon;
select assert(not has_function_privilege('anon', 'public.qr_scan_stats(integer)', 'execute'),
  'anon cannot read the whole marketing picture');
select assert(has_function_privilege('service_role', 'public.qr_scan_stats(integer)', 'execute'),
  'service_role can');

\echo ''
\echo 'qr landing: all checks passed'
