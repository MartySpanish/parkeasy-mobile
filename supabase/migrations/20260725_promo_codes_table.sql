-- Promo codes as DATA, not env config. Each row: code, days granted, window,
-- active flag. The redeem endpoint checks this table first and falls back to
-- the legacy env config (PROMO_CODE/PROMO_DAYS/PROMO_START/PROMO_END) so the
-- existing PARKEZ setup keeps working untouched.
-- Managed from the Supabase dashboard — new codes need no deploy.
create table if not exists public.promo_codes (
  code       text primary key,
  days       integer not null check (days between 1 and 730),
  starts_at  timestamptz,
  ends_at    timestamptz,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- Server-side reads only (service role bypasses RLS); no public policies.
alter table public.promo_codes enable row level security;

-- 6-month influencer code. Case-insensitive matching happens in the endpoint.
insert into public.promo_codes (code, days, starts_at, ends_at, active)
values ('PARKEZ6M', 180, now(), '2027-01-31 23:59:59+00', true)
on conflict (code) do nothing;
