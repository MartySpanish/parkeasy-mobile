-- Rows that exist BEFORE 20260902_gem_region.sql runs.
--
-- Applied as part of the migration chain, ahead of the region migration, so
-- the backfill has something to act on. Without this the test table is empty
-- when the migration runs, the backfill is a no-op, and every row in the test
-- is classified by the TRIGGER instead — which means a backfill rewritten to
-- use a bounding box would pass the whole suite. That mutation was tried and
-- got through, which is why this file exists.
insert into public.hidden_gems (legacy_id, name, near, town, lat, lng, status, restriction) values
  ('8001', 'Pre Belfast',    'Botanic',    'belfast',     54.5831, -5.9858, 'published', 'Free'),
  ('8002', 'Pre Derry',      'Foyleside',  'derry',       55.0030, -7.3300, 'published', 'Free'),
  ('8003', 'Pre Dublin',     'Dollymount', 'dublin',      53.3300, -6.2800, 'published', 'Free'),
  -- The two that a bounding box gets wrong: County Donegal, inside any
  -- rectangle drawn round Northern Ireland.
  ('8004', 'Pre Malin Head', 'Inishowen',  'malin head',  55.3800, -7.3740, 'published', 'Free'),
  ('8005', 'Pre Dunfanaghy', 'Sheephaven', 'dunfanaghy',  55.1880, -7.9650, 'published', 'Free');

-- Pre-migration rows have no premium flag either, so the backfill of that
-- column has something to fix too.
update public.hidden_gems set premium = null where legacy_id like '80%';
