-- Photos of a spot: who may add one, who may see it, and when.
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
  ('11111111-1111-1111-1111-111111111111','ann@example.test'),
  ('22222222-2222-2222-2222-222222222222','bob@example.test');

grant usage on schema public to anon, authenticated;

--------------------------------------------------------------------------------
\echo ''
\echo '1. A driver can offer a photo, and only as themselves'
--------------------------------------------------------------------------------
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111', false);

insert into public.spot_photos (spot_key, photo_url, caption, submitted_by, submitter_name)
values ('66','https://example.test/a.jpg','Entrance is round the back',
        '11111111-1111-1111-1111-111111111111','Ann');
select assert(true, 'a signed-in driver can add a photo to a gem');

do $$ begin
  insert into public.spot_photos (spot_key, photo_url, submitted_by, submitter_name)
  values ('66','https://example.test/b.jpg','22222222-2222-2222-2222-222222222222','Not Ann');
  raise exception 'FAIL  a photo was submitted in somebody else''s name';
exception when insufficient_privilege then
  raise notice '  PASS  but not in somebody else''s name';
end $$;

do $$ begin
  insert into public.spot_photos (spot_key, photo_url, submitted_by, submitter_name, status)
  values ('66','https://example.test/c.jpg','11111111-1111-1111-1111-111111111111','Ann','approved');
  raise exception 'FAIL  a driver approved their own photo on the way in';
exception when insufficient_privilege then
  raise notice '  PASS  and cannot approve it themselves on the way in';
end $$;

do $$ begin
  insert into public.spot_photos (spot_key, photo_url, submitted_by, submitter_name)
  values ('66','https://example.test/dupe.jpg','11111111-1111-1111-1111-111111111111','Ann');
  raise exception 'FAIL  a second pending photo for the same spot and person was accepted';
exception when unique_violation then
  raise notice '  PASS  a double tap cannot queue the same picture twice';
end $$;

-- A DIFFERENT person on the same spot is fine: the entrance, the bay and the
-- sign are three photos and three people.
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222', false);
insert into public.spot_photos (spot_key, photo_url, submitted_by, submitter_name)
values ('66','https://example.test/bob.jpg','22222222-2222-2222-2222-222222222222','Bob');
select assert(true, 'a second driver can add their own photo of the same spot');

-- And a bookable listing uses the same table, via the rental- prefix.
insert into public.spot_photos (spot_key, photo_url, submitted_by, submitter_name)
values ('rental-aaaaaaaa-0000-0000-0000-000000000001','https://example.test/l.jpg',
        '22222222-2222-2222-2222-222222222222','Bob');
select assert(true, 'and the same table takes a photo of a bookable listing');

--------------------------------------------------------------------------------
\echo ''
\echo '2. Nothing is visible until it has been reviewed'
--------------------------------------------------------------------------------
select assert((select count(*) from public.spot_photos_public) = 0,
  'a pending photo appears to nobody');
select assert((select count(*) from public.spot_photos) = 2,
  'though Bob can still see his own two while they wait');

select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111', false);
select assert((select count(*) from public.spot_photos) = 1,
  'and Ann sees only hers, not Bob''s');

reset role;
update public.spot_photos set status = 'approved', reviewed_at = now()
 where submitter_name = 'Ann';

select assert((select count(*) from public.spot_photos_public where spot_key = '66') = 1,
  'once approved it is public');
select assert(
  (select caption from public.spot_photos_public where spot_key='66') = 'Entrance is round the back',
  'with its caption');

--------------------------------------------------------------------------------
\echo ''
\echo '3. The public view carries a photo, not an account'
--------------------------------------------------------------------------------
select assert(not exists (
  select 1 from information_schema.columns
   where table_name='spot_photos_public'
     and column_name in ('submitted_by','review_note','status','reviewed_at')),
  'no submitter id, no review note, no status on the public view');
select assert(exists (
  select 1 from information_schema.columns
   where table_name='spot_photos_public' and column_name='submitter_name'),
  'just the first name it is credited to');

select assert(has_table_privilege('anon','public.spot_photos_public','select'),
  'a signed-out driver can see approved photos');
select assert(not has_table_privilege('anon','public.spot_photos','select'),
  'but not the table behind them');
select assert(not has_table_privilege('anon','public.spot_photos','insert'),
  'and cannot add one without an account');
select assert(not has_table_privilege('authenticated','public.spot_photos','update'),
  'nobody approves a photo from the browser — that is the service key''s job');
select assert(not has_table_privilege('authenticated','public.spot_photos','delete'),
  'nor deletes one');

\echo ''
\echo 'ALL CHECKS PASSED'
