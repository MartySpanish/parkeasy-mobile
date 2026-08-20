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
--   rental_listings    supabase/migrations/20260625_rental_listings.sql
--                      supabase/migrations/20260704_listing_requirements.sql
--
-- rental_listings was the last one to go, and it was the same mistake twice
-- over: the stub had five columns, so every suite that touched a listing was
-- testing against something that would let anything publish, while the real
-- table has ELEVEN check constraints gating status='active'. Passing the real
-- migrations means the tests now meet the rules production actually enforces.
--
-- This file is only for what Supabase itself provides and no migration ever
-- creates: the auth schema, auth.uid(), auth.jwt(), the roles, and the storage
-- schema below.

-- ── storage ──────────────────────────────────────────────────────────────────
-- Supabase Storage. 20260704_listing_requirements.sql creates the
-- listing-photos bucket and four RLS policies on storage.objects, so a chain
-- that includes that migration needs somewhere to put them. Thin on purpose:
-- nothing here is under test, it only has to exist and behave the same way for
-- an insert and a policy. auth.role() and storage.foldername() are the two
-- functions those policies call.
create schema if not exists storage;

create table if not exists storage.buckets (
  id     text primary key,
  name   text not null,
  public boolean not null default false
);

create table if not exists storage.objects (
  id        uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets(id),
  name      text,
  owner     uuid
);

alter table storage.objects enable row level security;

create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon');
$$;

-- Supabase's own helper: splits an object path into its folder segments, so a
-- policy can check the first one against auth.uid().
create or replace function storage.foldername(p_name text) returns text[]
language sql immutable as $$
  select string_to_array(regexp_replace(coalesce(p_name,''), '/[^/]*$', ''), '/');
$$;

