-- Listings that exist BEFORE 20260907_host_approval.sql runs.
--
-- Applied ahead of the migration in the chain so its backfill has rows to act
-- on. Without this every listing in the test is created afterwards and given
-- its flag by hand, so a migration that forgot to backfill anything at all
-- still passes. That mutation was tried and got through, which is why this
-- file exists — the same trap as tests/db/gem_region_seed.sql.
insert into public.rental_listings (id, title, address, lat, lng, space_type, status) values
  ('cccccccc-0000-0000-0000-000000000001', 'Pre driveway',  '2 Manor Close', 54.59, -5.93, 'driveway', 'active'),
  ('cccccccc-0000-0000-0000-000000000002', 'Pre club park', 'Somewhere Rd',  54.58, -5.98, 'car_park', 'active');
