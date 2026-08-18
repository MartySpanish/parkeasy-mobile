-- Community capacity for free spots. APPLIED 18 Aug 2026.
--
-- WHY. 263 of 441 free and hidden-gem spots have no capacity recorded, and the
-- smallest recorded anywhere is 4. That is why the "every space is claimed"
-- backstop almost never fires: it needs a capacity to compare against, and for
-- most spots there isn't one. Nobody is going to survey 263 streets. The people
-- already parked there can answer it in one tap.
--
-- A BAND, NOT A NUMBER. Drivers glance, they don't count bays. Asking for a
-- precise figure invites a confident wrong one; asking "roughly how many" and
-- storing the LOW end of the band is a claim the answer can support, and it
-- errs toward warning sooner — the safe direction to be wrong in.
--
-- MEDIAN, NOT MEAN, in the view: one person answering "10+" for a two-space
-- lay-by should not drag the estimate up on its own. The app also refuses to
-- use an estimate with fewer than two reports behind it.
create table if not exists public.spot_capacity_reports (
  id         uuid primary key default gen_random_uuid(),
  spot_id    text not null,
  spaces     integer not null check (spaces between 1 and 500),
  -- Opaque per-device key, same scheme as spot_occupancy. Never a user id —
  -- the whole app works signed out and this must too.
  client_key text not null,
  created_at timestamptz not null default now(),
  -- One answer per device per spot: changing your mind updates it, tapping
  -- twice does not become two votes.
  unique (spot_id, client_key)
);

create index if not exists spot_capacity_reports_spot_idx
  on public.spot_capacity_reports (spot_id);

-- RLS on with NO policies, matching spot_occupancy: reachable only through
-- /api/occupancy with the service role, read only as an aggregate. client_key
-- is a device identifier and must never be publicly selectable.
alter table public.spot_capacity_reports enable row level security;

create or replace view public.spot_capacity_estimates as
select
  spot_id,
  percentile_disc(0.5) within group (order by spaces)::int as spaces,
  count(*)::int as reports
from public.spot_capacity_reports
group by spot_id;
