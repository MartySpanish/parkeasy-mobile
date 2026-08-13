-- "I'm heading there" for free and hidden-gem spots. APPLIED 12 Aug 2026.
--
-- spot_occupancy already carried a live signal, but it only ever fires from the
-- parking timer — i.e. once a driver has ARRIVED. That is too late for the case
-- this exists for: a hidden gem with two spaces is worthless if three Premium
-- subscribers set off for it at the same moment, and the first any of them
-- learns of the others is when they get there.
--
-- So the same table gains a second kind of row. 'parked' is the existing timer
-- signal; 'heading' is a driver on their way.
--
-- THE TWO TTLs DIFFER, and that is the whole design. Parked lasts four hours,
-- roughly how long somebody leaves a car. Heading lasts THIRTY MINUTES,
-- because a stale claim on a free kerbside space is worse than no claim: it
-- sends the next driver past a space that is actually empty. Nobody has to
-- remember to clear it — the view simply stops counting it.
--
-- WHAT THIS IS NOT. It is not a booking and the UI never calls it one. Nobody
-- owns a public kerbside space, so ParkEasy cannot hold one and must not imply
-- that it has. What it honestly reports is that another driver is on their way,
-- which is the thing worth knowing before you set off.

alter table spot_occupancy
  add column if not exists kind text not null default 'parked';

alter table spot_occupancy
  drop constraint if exists spot_occupancy_kind_chk;
alter table spot_occupancy
  add constraint spot_occupancy_kind_chk check (kind in ('parked', 'heading'));

-- The old partial unique index stops one device counting as several drivers on
-- the same spot. It has to be per-kind now, so a driver can say "heading" and
-- then start a timer on arrival without the second write being swallowed as a
-- duplicate.
drop index if exists spot_occupancy_open_uniq;
create unique index if not exists spot_occupancy_open_kind_uniq
  on spot_occupancy (spot_id, client_key, kind)
  where ended_at is null;

-- in_use stays the first column and keeps its exact meaning, so anything
-- reading the old shape is unaffected. heading is appended.
create or replace view spot_occupancy_live as
select spot_id,
       count(*) filter (
         where kind = 'parked'  and started_at > now() - interval '4 hours'
       )::integer as in_use,
       count(*) filter (
         where kind = 'heading' and started_at > now() - interval '30 minutes'
       )::integer as heading
from spot_occupancy
where ended_at is null
group by spot_id
having count(*) filter (where kind = 'parked'  and started_at > now() - interval '4 hours') > 0
    or count(*) filter (where kind = 'heading' and started_at > now() - interval '30 minutes') > 0;

-- Verified on the live database with four seeded rows before any code depended
-- on it: a 31-minute-old 'heading' had already expired while a 31-minute-old
-- 'parked' was still counted, and a 5-hour-old 'parked' had expired too.
