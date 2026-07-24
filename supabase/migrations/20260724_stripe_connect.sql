-- Stripe Connect: host payout accounts + bookings.
-- Marketplace model (destination charges): drivers pay ParkEasy's platform
-- account via hosted Stripe Checkout; Stripe auto-transfers the host's 85% to
-- their connected account and ParkEasy keeps 15% + the driver service fee as
-- the application fee. Hosts are Express connected accounts (transfers only).
-- TEST MODE ONLY until public-liability insurance is in place.
--
-- Supabase is a CACHE of Stripe account state, kept current by the
-- /api/webhooks/stripe endpoint. Stripe is the source of truth.
create extension if not exists pgcrypto;

-- One Stripe connected account per host (listing owner).
create table if not exists public.host_accounts (
  id                uuid primary key default gen_random_uuid(),
  host_id           uuid not null references auth.users(id) on delete cascade,
  stripe_account_id text unique,
  onboarding_status text not null default 'pending',  -- pending | onboarding | active | restricted
  transfers_active  boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint host_accounts_host_uniq unique (host_id)
);

alter table public.host_accounts enable row level security;

-- A host may read their own payout-account status (to show onboarding state).
-- All writes happen server-side with the service-role key (webhooks + endpoints).
drop policy if exists "own host account readable" on public.host_accounts;
create policy "own host account readable" on public.host_accounts
  for select using (auth.uid() = host_id);

create index if not exists host_accounts_stripe_idx on public.host_accounts (stripe_account_id);

-- Driver bookings paid via Stripe Checkout. All money in integer pence, GBP.
create table if not exists public.bookings (
  id                     uuid primary key default gen_random_uuid(),
  listing_id             uuid references public.rental_listings(id) on delete set null,
  host_id                uuid references auth.users(id) on delete set null,
  driver_id              uuid references auth.users(id) on delete set null,
  driver_email           text,
  starts_at              timestamptz,
  duration_hours         integer,
  currency               text not null default 'gbp',
  amount_total_pence     integer not null,   -- what the driver pays (booking price + service fee)
  booking_price_pence    integer not null,   -- host's gross booking price (before the 15% cut)
  application_fee_pence  integer not null,   -- ParkEasy's cut: 15% of booking + 100% of service fee
  service_fee_pence      integer not null,   -- driver service fee (kept entirely by ParkEasy)
  stripe_session_id      text unique,
  stripe_payment_intent  text,
  stripe_destination     text,               -- host connected account the funds transfer to
  status                 text not null default 'pending',  -- pending | paid | failed | refunded
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

alter table public.bookings enable row level security;

-- Drivers and hosts may read their own bookings; all writes are server-side.
drop policy if exists "own bookings readable" on public.bookings;
create policy "own bookings readable" on public.bookings
  for select using (auth.uid() = driver_id or auth.uid() = host_id);

create index if not exists bookings_session_idx on public.bookings (stripe_session_id);
create index if not exists bookings_host_idx on public.bookings (host_id, created_at desc);
