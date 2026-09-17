-- QR codes and scans as they exist BEFORE 20260907_qr_landing.sql runs.
-- qr_codes and qr_scans were never created by a migration either, so the
-- tables are defined here for the throwaway cluster; production already has
-- them and the migration only touches data and adds a function.
create table if not exists public.qr_codes (
  code       text primary key,
  medium     text,
  location   text,
  area       text,
  postcode   text,
  audience   text,
  lands_on   text,
  placed_at  date,
  quantity   integer,
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.qr_scans (
  id         bigserial primary key,
  code       text,
  session_id uuid,
  user_agent text,
  referrer   text,
  created_at timestamptz not null default now()
);

-- The three landing shapes that exist in production, so the backfill has the
-- broken ones to act on.
insert into public.qr_codes (code, medium, area, location, lands_on, quantity) values
  ('fl',   'sticker', 'Falls',   'Cafes, Falls Rd',       '/belfast?src=fl',  6),
  ('gaa',  'flyer',   'Various', 'GAA clubs',             '/host?src=gaa',    7),
  ('ch',   'flyer',   'Various', 'Churches',              '/host?src=ch',     6),
  ('cab',  'flyer',   'City',    'Taxi dispatch desks',   '/fleadh?src=cab',  2);

insert into public.qr_scans (code, created_at) values
  ('fl', now() - interval '1 day'),
  ('fl', now() - interval '2 days'),
  ('fl', now() - interval '30 days'),
  ('gaa', now() - interval '3 days');
