-- Local-only stand-ins for the pieces of Supabase that the migrations expect.
-- Applied ONLY by tests/db/run.sh against a throwaway cluster; never shipped to
-- production, where the real auth schema and the real rental_listings exist.
--
-- The point is that the migration under test is byte-for-byte the file that
-- will be applied to production — nothing about it is rewritten for the test.
create schema if not exists auth;

create table if not exists auth.users (
  id    uuid primary key default gen_random_uuid(),
  email text
);

-- Supabase sets request.jwt.claims per request; auth.uid() reads it. Tests set
-- the same GUC with set_config, so the RLS policies exercise the real code path.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

-- auth.jwt() returns the whole claims object. Needed because Premium can be
-- held against an email with no linked user_id — there is one such live row —
-- so has_premium() has to read the email claim, not just the subject.
create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
$$;

-- Supabase's roles, so grant/revoke in the migration resolve.
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;

-- auth.role(), and the storage schema. Supabase provides both; no migration in
-- this repo creates either, and 20260704_listing_requirements.sql needs all of
-- it — it registers the listing-photos bucket and writes four policies over
-- storage.objects. Without these the chain that builds the REAL rental_listings
-- cannot be applied at all, which is why the publish constraints went untested
-- for as long as they did.
create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'anon');
$$;

create schema if not exists storage;

create table if not exists storage.buckets (
  id     text primary key,
  name   text,
  public boolean not null default false
);

create table if not exists storage.objects (
  id        uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name      text,
  owner     uuid
);
alter table storage.objects enable row level security;

-- Supabase splits an object name on '/' to get its folder path; the listing and
-- spot photo policies key ownership off the first segment.
create or replace function storage.foldername(p_name text) returns text[]
language sql immutable as $$ select string_to_array(p_name, '/'); $$;

grant usage on schema storage to anon, authenticated, service_role;

-- Enough of rental_listings for the FKs, the settlement view's join and the
-- cluster view's distance test. The real table has ~30 more columns and none of
-- them matter here — but lat/lng do, and leaving them out made
-- hotspot_clusters fail on a column the real table has had since June.
-- NOTHING THAT A REAL MIGRATION CREATES BELONGS IN THIS FILE.
--
-- promo_redemptions and spot_submissions were both stubbed here for a while and
-- both were a mistake: `create table if not exists` in the real migration then
-- silently did nothing, and the policy two lines below it failed on a column
-- the stub did not have. The stub looked like it was helping right up to the
-- point it shadowed the thing under test.
--
-- Real tables come from real migrations — pass them in the chain:
--   promo_redemptions  supabase/migrations/20260707_promo_codes.sql
--   spot_submissions   supabase/migrations/20260720_spot_submissions.sql
--
-- This file is only for what Supabase itself provides and no migration ever
-- creates: the auth schema, the roles, and a rental_listings stub thin enough
-- not to pretend it is the real one.

--
-- AND IT STANDS DOWN when the real one is in the chain. run.sh sets
-- parkeasy.real_listings when it sees 20260625_rental_listings.sql among the
-- migrations, because otherwise `create table if not exists` in that migration
-- would quietly do nothing and every column added by the twenty ALTERs after it
-- would land on this six-column fiction. That is the exact trap this comment
-- has warned about twice; it is now enforced rather than described.
do $$
begin
  if coalesce(current_setting('parkeasy.real_listings', true), '') = '1' then
    raise notice 'harness: rental_listings stub stood down — the real migration is in the chain';
  else
    create table if not exists public.rental_listings (
      id      uuid primary key default gen_random_uuid(),
      title   text not null,
      address text,
      lat     float,
      lng     float,
      status  text not null default 'active'
    );
  end if;
end $$;
