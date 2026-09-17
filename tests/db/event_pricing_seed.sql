-- venues, events and listing_price_overrides, defined for the throwaway
-- cluster. None of the three was ever created by a migration — they exist in
-- production only — so there is nothing for tests/db/run.sh to apply
-- 20260907_event_pricing.sql against without this. Columns match production.
create table if not exists public.venues (
  id uuid primary key default gen_random_uuid(),
  slug text, name text, aka text[], venue_type text, address text, postcode text,
  town text, lat double precision, lng double precision, geo_verified boolean,
  capacity integer, website_url text, listings_url text, parking_notes text,
  active boolean default true, created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid references public.venues(id), slug text, name text, subtitle text,
  category text, starts_at timestamptz, doors_at timestamptz, ends_at timestamptz,
  expected_attendance integer, demand_tier text, status text, ticket_url text,
  source_url text, notes text, source text, last_seen_at timestamptz,
  created_at timestamptz default now(), updated_at timestamptz default now()
);

create table if not exists public.listing_price_overrides (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid references public.rental_listings(id) on delete cascade,
  override_date date,
  price_pence integer check (price_pence > 0),
  created_at timestamptz default now(), updated_at timestamptz default now(),
  constraint listing_date_uniq unique (listing_id, override_date)
);

-- Belfast geography, real coordinates. The distances between these are what
-- the radius test turns on.
insert into public.venues (id, slug, name, lat, lng) values
  ('11111111-0000-0000-0000-000000000001', 'o2-belfast', 'The O2 Belfast', 54.6045, -5.9130),
  ('11111111-0000-0000-0000-000000000002', 'windsor',    'Windsor Park',   54.5817, -5.9556);

insert into public.rental_listings (id, title, address, lat, lng, status, price_per_day, price_per_hour)
values
  -- ~1.9 km from the O2: inside a 2 km radius, outside 1.5 km. This is the
  -- real gap the radius decision was made on.
  ('22222222-0000-0000-0000-000000000001', 'Near the arena', '5 Manor Close', 54.5900, -5.9250, 'active', 20, 3),
  -- Miles away from both.
  ('22222222-0000-0000-0000-000000000002', 'Far away',       'Coleraine',     55.1300, -6.6600, 'active', 10, 2);

insert into public.events (id, venue_id, name, starts_at, demand_tier, status) values
  ('33333333-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000001',
   'A big gig',      now() + interval '10 days', 'high',   'scheduled'),
  ('33333333-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000001',
   'A cancelled gig', now() + interval '11 days', 'major',  'cancelled'),
  ('33333333-0000-0000-0000-000000000003', '11111111-0000-0000-0000-000000000001',
   'A quiet night',  now() + interval '12 days', 'low',    'scheduled'),
  ('33333333-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000001',
   'Last year''s gig', now() - interval '30 days', 'major', 'scheduled');
