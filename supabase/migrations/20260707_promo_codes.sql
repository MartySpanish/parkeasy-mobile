-- Promo-code redemptions (e.g. PARKEZ → 7 days Premium).
-- Source of truth for WHO redeemed, WHEN, and when their entitlement expires.
-- Writes/counts happen server-side with the service-role key (bypasses RLS).
create extension if not exists pgcrypto;

create table if not exists public.promo_redemptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  user_email  text,
  code        text not null,
  redeemed_at timestamptz not null default now(),
  expires_at  timestamptz not null,
  -- One redemption per account per code.
  constraint promo_redemptions_user_code_uniq unique (user_id, code)
);

create index if not exists promo_redemptions_code_idx on public.promo_redemptions (code);

alter table public.promo_redemptions enable row level security;

-- Users may read only their own redemptions. There are no insert/update policies
-- for regular users — the redeem API writes with the service-role key.
drop policy if exists "own_redemptions_readable" on public.promo_redemptions;
create policy "own_redemptions_readable" on public.promo_redemptions
  for select using (auth.uid() = user_id);

-- Handy count for the admin dashboard / manual checks:
--   select count(*) from public.promo_redemptions where code = 'PARKEZ';
