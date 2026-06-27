-- Private space rental listings
create table if not exists rental_listings (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid references auth.users(id) on delete set null,
  owner_email   text,
  title         text not null,
  description   text,
  address       text not null,
  lat           float,
  lng           float,
  space_type    text not null default 'driveway',
  price_per_hour  numeric(6,2),
  price_per_day   numeric(7,2),
  price_per_month numeric(8,2),
  spaces        integer not null default 1,
  amenities     text[] not null default '{}',
  photos        text[] not null default '{}',
  contact_email text,
  contact_phone text,
  status        text not null default 'active',
  created_at    timestamptz not null default now()
);

alter table rental_listings enable row level security;

-- Anyone can read active listings
create policy "Public read active listings"
  on rental_listings for select
  using (status = 'active');

-- Authenticated users can insert their own listings
create policy "Users can list their own spaces"
  on rental_listings for insert
  with check (auth.uid() = owner_id or owner_id is null);

-- Users can update/deactivate their own listings
create policy "Users can manage their own listings"
  on rental_listings for update
  using (auth.uid() = owner_id);

create index on rental_listings (status, created_at desc);
create index on rental_listings (owner_id);
