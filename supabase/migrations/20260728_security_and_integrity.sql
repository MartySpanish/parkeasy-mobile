-- Security and integrity fixes. Each block is independent and idempotent, so
-- this can be run whole or in pieces, and re-run safely.
--
-- Ordered by severity. 1 and 2 are live data-exposure / fraud holes; 3 is a
-- money bug; 4 makes guest bookings visible to the guest at all.

--------------------------------------------------------------------------------
-- 1. CRITICAL — anon can read gate codes, phone numbers and host emails.
--
-- "Public read active listings" grants anon SELECT on EVERY column of an active
-- listing, including access_method, instructions, access_contact_phone and
-- owner_email. The moment a listing goes live, anyone can read how to get into
-- the space without booking it, plus the host's personal contact details.
--
-- Fix: expose a view of safe columns only, and drop anon's read of the table.
-- Access instructions must be served from an authenticated/token endpoint to
-- the person who actually booked. Better product too: "the code is on your
-- confirmation" is a reason to book rather than a thing to screenshot.
--------------------------------------------------------------------------------

create or replace view public.listings_public
with (security_invoker = true) as
select
  id, title, address, lat, lng,
  space_type, host_type, spaces,
  price_per_hour, price_per_day, price_per_month,
  amenities, photos, availability,
  is_verified, verified_org_type,
  completed_bookings_count, average_rating, ratings_count,
  created_at
from public.rental_listings
where status = 'active';

grant select on public.listings_public to anon, authenticated;

-- Deliberately NOT dropped automatically: removing the table policy will break
-- any client still selecting from rental_listings directly. Point the client at
-- listings_public first, confirm nothing 404s, THEN run:
--
--   drop policy if exists "Public read active listings" on public.rental_listings;
--
-- Left as a manual step because dropping it blind is how you take the map down.

--------------------------------------------------------------------------------
-- 2. CRITICAL — any signed-in host can award themselves a verified badge.
--
-- guard_admin_columns protects only approved_by_founder and rejection_reason.
-- Nothing stops a host PATCHing is_verified, verified_org_type, a 4.9 rating,
-- 300 completed bookings, or status='active' straight past the publish checks.
-- One club spotting a rival's fake badge is the trust moat gone.
--------------------------------------------------------------------------------

create or replace function public.guard_listing_trust_columns()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- The service role is the app's own backend; it is allowed to set these.
  if current_setting('request.jwt.claim.role', true) = 'service_role'
     or current_user = 'service_role' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- A newly created listing never starts trusted or published.
    new.is_verified               := false;
    new.verified_org_type         := null;
    new.completed_bookings_count  := 0;
    new.average_rating            := null;
    new.ratings_count             := 0;
    if new.status is distinct from 'draft' then
      new.status := 'draft';
    end if;
    return new;
  end if;

  -- UPDATE: silently hold every trust signal at its stored value rather than
  -- raising. A host editing their title should not get an error about a column
  -- they never touched.
  new.is_verified              := old.is_verified;
  new.verified_org_type        := old.verified_org_type;
  new.completed_bookings_count := old.completed_bookings_count;
  new.average_rating           := old.average_rating;
  new.ratings_count            := old.ratings_count;

  -- Going live is a server decision: it is what the publish CHECK constraints
  -- gate, and a client must not be able to skip them.
  if new.status = 'active' and old.status is distinct from 'active' then
    raise exception 'Listings are published by ParkEasy, not directly. Use the publish flow.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

revoke execute on function public.guard_listing_trust_columns() from public, anon, authenticated;

drop trigger if exists guard_listing_trust_columns_ins on public.rental_listings;
create trigger guard_listing_trust_columns_ins
  before insert on public.rental_listings
  for each row execute function public.guard_listing_trust_columns();

drop trigger if exists guard_listing_trust_columns_upd on public.rental_listings;
create trigger guard_listing_trust_columns_upd
  before update on public.rental_listings
  for each row execute function public.guard_listing_trust_columns();

--------------------------------------------------------------------------------
-- 3. HIGH — two drivers can pay for the same space at the same time.
--
-- bookings_overlap_idx is a plain btree index. An index does not prevent
-- anything; it only makes lookups fast. Nothing stops two concurrent inserts
-- for the same listing and overlapping window. A double-booked space on a match
-- day is a refund, a chargeback and a Facebook post.
--
-- ends_at must be present for the range to mean anything; rows without it are
-- excluded rather than silently treated as zero-length.
--------------------------------------------------------------------------------

create extension if not exists btree_gist;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'bookings_no_overlap'
  ) then
    alter table public.bookings
      add constraint bookings_no_overlap
      exclude using gist (
        listing_id with =,
        tstzrange(starts_at, ends_at, '[)') with &&
      )
      where (status in ('pending', 'paid') and ends_at is not null);
  end if;
end $$;

-- The checkout route must catch SQLSTATE 23P01 and return 409 "just taken"
-- rather than a 500.

--------------------------------------------------------------------------------
-- 4. HIGH — a guest can never see their own booking.
--
-- The bookings SELECT policy is auth.uid() = driver_id. For a guest checkout
-- both sides are NULL, and NULL = NULL evaluates to NULL, not true. So the
-- booking is invisible to the person who paid for it — while the homepage says
-- "No account needed". Fixed with an unguessable token rather than by loosening
-- RLS, so nothing else becomes readable.
--------------------------------------------------------------------------------

alter table public.bookings
  add column if not exists access_token uuid not null default gen_random_uuid();

create unique index if not exists bookings_access_token_idx
  on public.bookings (access_token);

comment on column public.bookings.access_token is
  'Unguessable per-booking token. Lets a guest (no account) retrieve their own booking via a service-role endpoint. Never expose in any public view or list response.';
