-- Live "in use" signal for spots, derived from the in-app parking timer.
-- APPLIED to production project bbgqregyogtjzaustbng on 28 Jul 2026.
--
-- When a driver starts the timer on a spot we already know they are parked
-- there. Sharing that back tells the next driver whether anyone is sitting in a
-- hidden gem that only fits three cars.
--
-- Deliberately not identity data: no user id, no email. A random per-device key
-- only, so a session can be ended by whoever started it and one phone cannot
-- inflate a spot by starting repeatedly.

create table if not exists public.spot_occupancy (
  id          uuid primary key default gen_random_uuid(),
  spot_id     text not null,
  client_key  text not null,
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  city        text
);

-- One open session per device per spot: a re-start replaces rather than stacks.
create unique index if not exists spot_occupancy_open_uniq
  on public.spot_occupancy (spot_id, client_key)
  where ended_at is null;

create index if not exists spot_occupancy_active_idx
  on public.spot_occupancy (spot_id, started_at desc)
  where ended_at is null;

alter table public.spot_occupancy enable row level security;
-- No policies: written and read only by the service role via /api/occupancy.

-- Aggregate only — a count, never who or when they arrived.
--
-- A session is treated as over after 4 hours whether or not the driver
-- remembered to stop the timer. People forget, and a spot stuck on "in use"
-- forever is worse than no signal: it would push drivers away from a space
-- that is actually empty.
create or replace view public.spot_occupancy_live
with (security_invoker = false) as
select spot_id, count(*)::int as in_use
from public.spot_occupancy
where ended_at is null
  and started_at > now() - interval '4 hours'
group by spot_id;

-- The default grant on the table was still present. RLS blocks reads today, but
-- the moment anyone adds a permissive policy the raw rows — client_key and
-- exact arrival times — become readable. Remove it so the aggregate view is the
-- only way in by construction, not by luck.
revoke all    on public.spot_occupancy      from anon, authenticated;
grant  select on public.spot_occupancy_live to   anon, authenticated;

comment on view public.spot_occupancy_live is
  'Count of drivers currently parked at each spot, from the parking timer. Sessions older than 4 hours are ignored so a forgotten timer cannot mark a spot busy indefinitely. Aggregate only — never expose spot_occupancy rows directly.';
