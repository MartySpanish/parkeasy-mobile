-- Somewhere to put a partner's logo and product shots that isn't the git repo.
--
-- ── THE PROBLEM THIS SOLVES ─────────────────────────────────────────────────
-- Every partner image in the product is a file committed to public/<slug>/ and
-- served off parkeasy.uk. That works, and it means the ONLY way to add one is a
-- commit, a build and a deploy. Marty has BFAST's logo and product shots on his
-- phone. He should not have to learn git to put a JPEG on a partner card, and
-- an assistant that cannot receive a file cannot do it for him.
--
-- A public bucket fixes both. He drags the files into the Supabase dashboard
-- from whatever device they are on, and the URLs are set from what is actually
-- in the bucket — see partner_photos_sync() below.
--
-- ── WHY NOT REUSE listing-photos ────────────────────────────────────────────
-- It exists and it is public, so it would have worked. But its insert policy is
-- written for DRIVERS uploading photos of their own space — the first folder
-- segment has to equal auth.uid() — and partner brand assets are neither owned
-- by a user nor user-generated. Mixing curated advertising material into a
-- bucket of user uploads means the next person to write a moderation sweep over
-- listing-photos has to remember that some of it is not user content. Cheaper
-- to keep them apart than to remember.
--
-- ── NOBODY CAN UPLOAD HERE FROM THE APP, ON PURPOSE ─────────────────────────
-- Read is public, because the images are rendered on a public page. Writes are
-- service-role only: no policy is created for anon or authenticated, so RLS
-- denies them by default. These are commercial assets belonging to a business
-- that is being advertised, and there is no version of "any signed-in user may
-- replace the logo on a partner's card" that ends well. The dashboard and the
-- server key both run as service_role, which is the intended route.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('partner-photos', 'partner-photos', true, 8388608,
        array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public read partner photos" on storage.objects;
create policy "Public read partner photos" on storage.objects
  for select using (bucket_id = 'partner-photos');

--------------------------------------------------------------------------------
-- Set a partner's images FROM WHAT IS ACTUALLY IN THE BUCKET
--------------------------------------------------------------------------------
-- Jack Daniels Fitness showed a broken-image icon for two days in August,
-- because logo_url was set to a file that was committed in an unmerged PR. The
-- URL existed, the image did not, and nothing anywhere connected the two.
--
-- This makes that mistake unrepresentable rather than merely discouraged: the
-- URL is DERIVED from storage.objects, so it cannot name a file that is not
-- there. Nobody has to remember the rule because there is no way to break it.
--
-- Convention: partner-photos/<slug>/…  and anything whose name starts with
-- "logo" becomes logo_url instead of joining the photo strip.
create or replace function public.partner_photos_sync(p_slug text)
returns table (slug text, logo text, photos integer)
language plpgsql security definer
set search_path = public, storage, pg_temp
as $$
declare
  -- The project ref, spelled out. An earlier draft derived it from the
  -- request.headers GUC so the function would not need editing if the project
  -- were ever restored under a different ref — which sounded tidy and was
  -- wrong twice over: the GUC is text and not json in a plain SQL session, so
  -- it errored outright, and a public asset URL that changes depending on WHO
  -- CALLED THE FUNCTION is a genuinely bad idea. One project, one host.
  v_base text := 'https://bbgqregyogtjzaustbng.supabase.co/storage/v1/object/public/partner-photos/';
  v_logo text;
  v_photos text[];
begin
  select v_base || o.name into v_logo
    from storage.objects o
   where o.bucket_id = 'partner-photos'
     and o.name like p_slug || '/%'
     and lower(split_part(o.name, '/', 2)) like 'logo%'
   order by o.name
   limit 1;

  -- Ordered by filename, so 1-…, 2-…, 3-… controls the order of the strip.
  -- The logo is excluded: it is a brand mark on a 28px square, not a photo of
  -- anything, and putting it in the banner would be the first thing a driver
  -- swiped past.
  select array_agg(v_base || o.name order by o.name) into v_photos
    from storage.objects o
   where o.bucket_id = 'partner-photos'
     and o.name like p_slug || '/%'
     and lower(split_part(o.name, '/', 2)) not like 'logo%';

  update public.partners p set
    logo_url   = coalesce(v_logo, p.logo_url),
    photo_urls = coalesce(v_photos, '{}'::text[]),
    photo_url  = coalesce(v_photos[1], v_logo, p.photo_url)
   where p.slug = p_slug;

  return query select p_slug, v_logo, coalesce(cardinality(v_photos), 0);
end $$;

revoke all on function public.partner_photos_sync(text) from public, anon, authenticated;
grant execute on function public.partner_photos_sync(text) to service_role;

comment on function public.partner_photos_sync(text) is
  'Point a partner''s logo_url/photo_urls at whatever is in partner-photos/<slug>/. '
  'Derived from storage.objects so a URL can never name a file that is not there — '
  'which is the bug that put a broken-image icon on Jack Daniels Fitness for two days. '
  'Files named logo* become the logo; the rest become the photo strip, ordered by filename.';
