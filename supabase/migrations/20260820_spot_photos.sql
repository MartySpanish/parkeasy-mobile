-- Photos of a spot, taken by the drivers who park there.
--
-- NOT YET APPLIED to production.
--
-- THE PROBLEM. A hidden gem is a description of a place: "quiet residential
-- street off the Glen Road", "small lay-by most people miss". That is enough to
-- find the street and not enough to recognise the spot when you pull up — which
-- is the moment the app is actually being used, from a car, in the rain. Not one
-- of the 89 gems has a photo, and there is no way to add one: the upload path
-- only exists on the form that creates a NEW submission, so a driver standing at
-- a gem with a camera in their hand has nowhere to put the picture.
--
-- WHY A SEPARATE TABLE RATHER THAN A COLUMN. A spot is not one photo. The
-- entrance, the bay itself and the sign that says when you will be ticketed are
-- three different pictures and different people will take them. A column would
-- mean the second person overwrites the first.
--
-- REVIEWED BEFORE IT SHOWS, like everything else here. A photo taken on a
-- street will sometimes contain a number plate, a face or a front door. That is
-- personal data and it is not something to publish on the strength of a tap.
create table if not exists public.spot_photos (
  id             uuid primary key default gen_random_uuid(),
  -- Same dual-shape convention as spot_occupancy.spot_id: a bare integer for a
  -- gem ("66") and 'rental-<uuid>' for a listing. Text, not a foreign key, for
  -- exactly the reason set out in 20260820_hidden_gems.sql — the two halves of
  -- the inventory have different key types and this column bridges them.
  spot_key       text not null,
  photo_url      text not null,
  -- "The entrance is round the back", "sign on the lamppost". One line, because
  -- the notes on the spot already carry the detail.
  caption        text,
  submitted_by   uuid references auth.users(id) on delete set null,
  submitter_name text,
  status         text not null default 'pending'
                   check (status in ('pending','approved','rejected')),
  review_note    text,
  reviewed_at    timestamptz,
  created_at     timestamptz not null default now()
);

create index if not exists spot_photos_spot_idx
  on public.spot_photos (spot_key, created_at desc) where status = 'approved';
create index if not exists spot_photos_queue_idx
  on public.spot_photos (created_at) where status = 'pending';

-- One pending photo per person per spot, so a double tap on a slow connection
-- cannot fill the review queue with the same picture.
create unique index if not exists spot_photos_one_pending_per_person
  on public.spot_photos (spot_key, submitted_by)
  where status = 'pending' and submitted_by is not null;

alter table public.spot_photos enable row level security;

-- Anyone signed in may offer a photo of a spot, and only as themselves.
drop policy if exists spot_photos_insert on public.spot_photos;
create policy spot_photos_insert on public.spot_photos
  for insert to authenticated
  with check (submitted_by = auth.uid() and status = 'pending');

-- You can see your own while it waits, so "did that send?" has an answer.
drop policy if exists spot_photos_own_read on public.spot_photos;
create policy spot_photos_own_read on public.spot_photos
  for select using (submitted_by = auth.uid());

revoke all on public.spot_photos from anon;
grant select, insert on public.spot_photos to authenticated;

-- WHAT EVERYBODY ELSE READS. Approved rows, and only the columns that belong on
-- a photo: no submitter id, no review note, no email. A picture credited to
-- "Ciaran M" does not need to carry the account behind it.
create or replace view public.spot_photos_public
with (security_invoker = false) as
select
  id,
  spot_key,
  photo_url,
  caption,
  submitter_name,
  created_at
from public.spot_photos
where status = 'approved';

grant select on public.spot_photos_public to anon, authenticated;

comment on view public.spot_photos_public is
  'Approved spot photos. No submitter id and no review note — a photo credited '
  'to a first name does not need the account behind it. Note the storage bucket '
  'itself is public, so a URL is public once it exists; what this view controls '
  'is whether anybody can FIND it.';

-- The review queue reads with the service key, same as spot_submissions. There
-- is deliberately no update policy: a driver cannot approve their own photo.
