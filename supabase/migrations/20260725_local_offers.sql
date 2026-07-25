-- Local business offers, v1: manual rows only (Marty inserts via the Supabase
-- dashboard). One offer per listing; shown on the booking confirmation
-- surfaces (email + in-app) while active and inside its date window.
-- No payment collection — invoicing the business is manual for now.
create table if not exists public.local_offers (
  id            uuid primary key default gen_random_uuid(),
  business_name text not null,
  description   text not null,
  offer_code    text,
  listing_id    uuid not null references public.rental_listings(id) on delete cascade,
  start_date    date,
  end_date      date,
  active        boolean not null default false,
  created_at    timestamptz not null default now()
);

alter table public.local_offers enable row level security;

-- Public read only while active and in-window (same pattern as partners).
drop policy if exists "offers_public_read" on public.local_offers;
create policy "offers_public_read" on public.local_offers
  for select to anon, authenticated
  using (
    active
    and (start_date is null or start_date <= current_date)
    and (end_date   is null or end_date   >= current_date)
  );

create index if not exists local_offers_listing_idx on public.local_offers (listing_id) where active;
