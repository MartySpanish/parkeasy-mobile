-- Community-submitted spots become public ONLY after founder approval.
-- APPLIED to production project bbgqregyogtjzaustbng on 28 Jul 2026.
--
-- Before this, spot_submissions had a single INSERT policy and no SELECT policy
-- at all, so a submitted spot could never be read back by anyone — it lived
-- only in the submitter's own browser and no approval could publish it.

alter table public.spot_submissions
  add column if not exists reviewed_at  timestamptz,
  add column if not exists review_note  text;

-- status: 'new' (awaiting review) -> 'approved' | 'rejected'
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'spot_submissions_status_valid') then
    alter table public.spot_submissions
      add constraint spot_submissions_status_valid
      check (status in ('new', 'approved', 'rejected'));
  end if;
end $$;

create index if not exists spot_submissions_status_idx
  on public.spot_submissions (status, created_at desc);

-- A DEFINER view, deliberately.
--
-- First attempt used security_invoker = true and returned NOTHING to anon, even
-- for approved rows, because it then applied the caller's RLS to a table with no
-- SELECT policy. Caught by reading the view as anon rather than assuming.
--
-- The other option — a SELECT policy on the base table — would let anon query
-- spot_submissions directly and read submitter_email with it. So the VIEW is the
-- access control: the only way in, a fixed safe projection, hard-filtered to
-- approved rows. anon is never granted select on the table itself.
create or replace view public.spots_public
with (security_invoker = false) as
select
  id, near, street, type, restriction, notes,
  lat, lng, photo_url, submitter_name, created_at
from public.spot_submissions
where status = 'approved'
  and lat is not null
  and lng is not null;

grant select on public.spots_public to anon, authenticated;

revoke all    on public.spot_submissions from anon;
revoke select on public.spot_submissions from authenticated;

comment on view public.spots_public is
  'Approved community spots, safe columns only, definer view. It is the ONLY public read path to spot_submissions — anon has no grant on the table, which keeps submitter_email private. Never add submitter_email or user_id here.';

-- Approving stays a service-role action (POST /api/admin with kind:"spot").
-- There is deliberately NO update policy for authenticated users: a submitter
-- must not be able to approve their own spot, which is the point of review.
