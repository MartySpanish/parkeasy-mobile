-- Partner images: the URL is derived from the bucket, so it cannot lie.
--
-- THE BUG THIS EXISTS TO KILL. Jack Daniels Fitness showed a broken-image icon
-- for two days because logo_url was set to a file committed in an unmerged PR.
-- The URL existed, the image did not, and nothing connected the two. Deriving
-- the URL from storage.objects makes that unrepresentable rather than merely
-- discouraged — there is no way to name a file that is not there.
\set ON_ERROR_STOP on
set client_min_messages = notice;

create or replace function assert(p_cond boolean, p_what text)
returns void language plpgsql as $$
begin
  if p_cond then raise notice '  PASS  %', p_what;
  else raise exception 'FAIL  %', p_what;
  end if;
end $$;

insert into public.partners (slug, name, tagline, lat, lng, active, logo_url, photo_urls)
values ('bfast','BFAST','Fightwear built in Belfast.', 54.5995, -5.9512, true, null, '{}'),
       ('other','Someone Else','A different business.',   54.5900, -5.9300, true, null, '{}');

\echo ''
\echo '1. An empty bucket sets nothing, rather than a URL to nothing'
select * from public.partner_photos_sync('bfast');
select assert(
  (select logo_url from public.partners where slug='bfast') is null
  and (select cardinality(photo_urls) from public.partners where slug='bfast') = 0,
  'no files, no URLs — the Jack Daniels failure cannot be reproduced');

\echo ''
\echo '2. A logo becomes the logo, and does not join the photo strip'
insert into storage.objects (bucket_id, name) values
  ('partner-photos','bfast/logo.png'),
  ('partner-photos','bfast/2-shorts.jpg'),
  ('partner-photos','bfast/1-tee.jpg'),
  ('partner-photos','bfast/3-gym.jpg');
select * from public.partner_photos_sync('bfast');

select assert(
  (select logo_url from public.partners where slug='bfast')
    = 'https://bbgqregyogtjzaustbng.supabase.co/storage/v1/object/public/partner-photos/bfast/logo.png',
  'the file called logo.png is the logo');
select assert(
  (select cardinality(photo_urls) from public.partners where slug='bfast') = 3,
  'and the other three are the photo strip — the logo is not in it');
-- A brand mark on a 28px square is not a photo of anything, and it would have
-- been the first thing a driver swiped past in the banner.
select assert(
  not exists (select 1 from public.partners, unnest(photo_urls) u
               where slug='bfast' and u like '%logo%'),
  'the logo is nowhere in the strip');

\echo ''
\echo '3. Filename decides the order, so the strip can be arranged without code'
select assert(
  (select photo_urls[1] from public.partners where slug='bfast') like '%1-tee.jpg'
  and (select photo_urls[2] from public.partners where slug='bfast') like '%2-shorts.jpg'
  and (select photo_urls[3] from public.partners where slug='bfast') like '%3-gym.jpg',
  'inserted 2, 1, 3 — comes back 1, 2, 3');

\echo ''
\echo '4. One partner''s folder cannot leak into another''s card'
insert into storage.objects (bucket_id, name) values ('partner-photos','other/1-shop.jpg');
select * from public.partner_photos_sync('other');
select assert(
  (select cardinality(photo_urls) from public.partners where slug='bfast') = 3,
  'syncing another partner leaves this one alone');
select assert(
  (select cardinality(photo_urls) from public.partners where slug='other') = 1,
  'and picks up only its own folder');

\echo ''
\echo '5. Deleting a file removes the URL — no orphan pointing at nothing'
delete from storage.objects where bucket_id='partner-photos' and name='bfast/2-shorts.jpg';
select * from public.partner_photos_sync('bfast');
select assert(
  (select cardinality(photo_urls) from public.partners where slug='bfast') = 2,
  'a removed photo disappears from the card on the next sync');

\echo ''
\echo '6. Another bucket is not this bucket'
-- listing-photos holds driver uploads of their own spaces. If that leaked in
-- here, somebody's driveway would appear on an advertiser's page. The bucket is
-- created by 20260704_listing_requirements.sql in production; created here
-- because this chain does not include it and storage.objects has a real FK.
insert into storage.buckets (id, name, public) values ('listing-photos','listing-photos',true)
  on conflict (id) do nothing;
insert into storage.objects (bucket_id, name) values ('listing-photos','bfast/sneaky.jpg');
select * from public.partner_photos_sync('bfast');
select assert(
  (select cardinality(photo_urls) from public.partners where slug='bfast') = 2,
  'a file in listing-photos is ignored, whatever it is called');

\echo ''
\echo '7. Only the server may write here'
select assert(
  not exists (
    select 1 from pg_policies
     where schemaname='storage' and tablename='objects'
       and cmd in ('INSERT','UPDATE','DELETE')
       and qual||coalesce(with_check,'') like '%partner-photos%'),
  'no anon or authenticated write policy — brand assets are curated, not uploaded');

\echo ''
\echo 'ALL PASSED'
