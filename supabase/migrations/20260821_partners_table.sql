-- The partners table, finally written down.
--
-- SIXTH INSTANCE of the same problem, and the largest: NO MIGRATION IN THIS
-- REPO CREATES public.partners. It has eleven live rows, thirty-two columns,
-- eight constraints, RLS and a public-read policy, and six migrations that ALTER
-- it — 20260803_partners_online.sql adds two columns to a table the repo has
-- never heard of. It was made by hand in the Supabase dashboard and never
-- recorded. The others: spot_submissions.photo_url, the nine columns missing
-- from listings_public, promo_redemptions.user_id, and bookings.surcharge_pence
-- and rental_listings.overnight_fee_commission_rate (written down yesterday in
-- 20260820_overnight_fee_columns.sql).
--
-- Found while trying to TEST partner_photos_sync(). The test needs a partners
-- table; the chain could not build one; there was nothing to test against. That
-- is the practical cost of drift — not that the database is wrong, but that
-- nothing about it can be checked.
--
-- TRANSCRIBED FROM PRODUCTION, not designed here: every column, default,
-- constraint, index and policy below was read out of information_schema,
-- pg_constraint, pg_indexes and pg_policies on 21 Aug 2026 and reproduced
-- exactly. `if not exists` throughout, so applying it to production changes
-- nothing at all — its whole job is to let a database be rebuilt from this repo.
create table if not exists public.partners (
  id             uuid primary key default gen_random_uuid(),
  slug           text not null unique,
  name           text not null,
  name_irish     text,
  -- NOT NULL. A partner card without a line of copy is a logo and a shrug.
  tagline        text not null,
  description    text,
  logo_url       text,
  photo_url      text,
  photo_urls     text[] not null default '{}'::text[],
  link_url       text,
  links          jsonb not null default '[]'::jsonb,
  address        text,
  postcode       text,
  -- NOT NULL even for an online partner, which is why is_online and
  -- geo_verified both exist: the columns demand a coordinate, and those two
  -- flags are what stop a city-centre placeholder being shown to somebody as a
  -- place to drive to.
  lat            double precision not null,
  lng            double precision not null,
  geo_verified   boolean not null default false,
  is_online      boolean not null default false,
  radius_m       integer not null default 800,
  priority       integer not null default 0,
  active         boolean not null default false,
  starts_at      timestamptz,
  ends_at        timestamptz,
  -- The commercial side. Every one of these is null on all eleven live rows:
  -- nobody is paying yet, and the order is editorial.
  price_pence    integer,
  billing_period text,
  invoice_email  text,
  contact_name   text,
  contact_phone  text,
  tier           text,
  sold_at        timestamptz,
  renewal_due_at timestamptz,
  notes          text,
  created_at     timestamptz not null default now(),
  constraint partners_lat_range   check (lat >= -90 and lat <= 90),
  constraint partners_lng_range   check (lng >= -180 and lng <= 180),
  constraint partners_radius_sane check (radius_m >= 100 and radius_m <= 5000),
  constraint partners_billing_period_chk
    check (billing_period is null or billing_period in ('monthly','quarterly','annual','one_off','free_trial')),
  constraint partners_tier_chk
    check (tier is null or tier in ('local','town','county','event','founding')),
  -- A remote business cannot have a radius that pulls it onto other listings'
  -- cards as "near this space". Also added by 20260803_partners_online.sql,
  -- which is fine — both are idempotent.
  constraint partners_online_has_no_address check (not is_online or address is null)
);

create index if not exists partners_active_idx on public.partners (active) where active;

alter table public.partners enable row level security;

-- Anyone may read a partner that is ACTIVE AND IN ITS WINDOW. starts_at and
-- ends_at are how a paid placement stops on its own: an advert that has to be
-- switched off by hand is an advert that runs for free until somebody notices.
drop policy if exists partners_public_read on public.partners;
create policy partners_public_read on public.partners
  for select using (
    active
    and (starts_at is null or starts_at <= now())
    and (ends_at   is null or ends_at   >= now())
  );

-- No insert, update or delete policy, deliberately: partners are curated from
-- the server key and there is no version of "a signed-in user may edit an
-- advertiser's row" that ends well.
