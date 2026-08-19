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

-- Enough of rental_listings for the FKs, the settlement view's join and the
-- cluster view's distance test. The real table has ~30 more columns and none of
-- them matter here — but lat/lng do, and leaving them out made
-- hotspot_clusters fail on a column the real table has had since June.
-- Premium entitlement. No subscriptions table exists: an unexpired row here IS
-- the subscription.
create table if not exists public.promo_redemptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users(id) on delete set null,
  user_email  text,
  code        text not null,
  redeemed_at timestamptz not null default now(),
  expires_at  timestamptz
);

create table if not exists public.spot_submissions (
  id          uuid primary key default gen_random_uuid(),
  near        text,
  street      text,
  restriction text,
  status      text not null default 'new',
  created_at  timestamptz not null default now()
);

create table if not exists public.rental_listings (
  id      uuid primary key default gen_random_uuid(),
  title   text not null,
  address text,
  lat     float,
  lng     float,
  status  text not null default 'active'
);
