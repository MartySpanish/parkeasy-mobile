-- Vehicle registration on bookings.
-- APPLIED to production project bbgqregyogtjzaustbng on 28 Jul 2026.
--
-- Asked for directly by the Katherine Methodist committee: "will we be able to
-- access the car registration of the cars booked through ParkEasy... this is
-- how we know who has booked and paid so we can direct them to their allocated
-- space." Without it a marshal standing in a car park has no way to match a car
-- to a paid booking, which is the whole job on the day.
--
-- Stored normalised (uppercase, no spaces) so 'ab12 cde' and 'AB12CDE' match
-- when someone is checking a plate against a list.
--
-- This is personal data. It is deliberately NOT added to any public view: the
-- existing bookings RLS already limits rows to the driver and the host of that
-- booking, and this column inherits that.

alter table public.bookings
  add column if not exists vehicle_reg text;

comment on column public.bookings.vehicle_reg is
  'Driver''s vehicle registration, normalised uppercase without spaces. Shown to the host of this booking so they can identify the car on arrival. Personal data — never expose beyond the booking''s driver and host.';

-- Marshals look plates up on the day, so make that lookup cheap.
create index if not exists bookings_vehicle_reg_idx
  on public.bookings (vehicle_reg)
  where vehicle_reg is not null;
