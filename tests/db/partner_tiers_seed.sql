-- Partners as they exist BEFORE 20260907_partner_tiers.sql runs: live, active,
-- and with a null tier. Applied ahead of the migration so the grandfathering
-- backfill has the rows it was written for.
--
-- Without this every partner in the test is created afterwards and arrives
-- carrying the new default, so a migration that forgot to grandfather anybody
-- would still pass — and the failure it hides is eleven real businesses losing
-- their card silently. Same trap as gem_region_seed.sql and
-- host_approval_seed.sql.
insert into public.partners (slug, name, tagline, lat, lng, active, priority) values
  ('pre-active-1', 'Pre Barbers', 'Cuts', 54.5831, -5.9858, true, 11),
  ('pre-active-2', 'Pre Guesthouse', 'Rooms', 54.5860, -5.9330, true, 20),
  ('pre-inactive', 'Pre Not Live', 'Soon', 54.5900, -5.9000, false, 0);
