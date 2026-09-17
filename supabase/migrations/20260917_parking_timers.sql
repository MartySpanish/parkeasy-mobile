-- Parking timers: the first thing on this platform that has to reach a driver
-- who has closed the tab.
--
-- THE PROBLEM A setTimeout CANNOT SOLVE. A driver parks on-street with a
-- two-hour limit and walks away. The page holding the countdown is frozen,
-- discarded or closed within minutes — a phone does that aggressively — so a
-- timer living in JavaScript is a timer that does not fire, and the first the
-- driver knows about it is the ticket. The reminder has to be sent from
-- somewhere that is still awake, which means it has to be written down here.
--
-- ONE LIVE TIMER PER SESSION. You are parked in one place at a time. Setting a
-- new timer replaces the old one rather than stacking, so a driver who changes
-- their mind twice does not get three notifications.
--
-- WHAT IS STORED, AND WHAT IS NOT. When the timer is due, a label to name the
-- place, and the coordinates to walk back to — the last of these is for the
-- notification's deep link, so that tapping it goes to the car rather than to
-- the home screen. There is no account required and none is recorded: the
-- session id is the client's own, the same one push_subscriptions is keyed on,
-- which is what lets a guest set a timer at all.
--
-- HOW IT GETS SENT. api/cron/parking-timers.js sweeps every five minutes,
-- finds the timers whose reminder is due, and pushes to that session's
-- subscriptions. Five minutes is the granularity of the promise the UI makes,
-- so the UI never offers a reminder shorter than ten.

begin;

create table if not exists public.parking_timers (
  session_id   uuid        primary key,
  -- When the parking itself runs out, and when to warn. Both stored: the
  -- notification says how long is left, and that sentence has to be true.
  due_at       timestamptz not null,
  remind_at    timestamptz not null,
  label        text,
  lat          double precision,
  lng          double precision,
  created_at   timestamptz not null default now(),
  -- Stamped when the push has gone out, so a sweep that overlaps the previous
  -- one cannot send the same reminder twice.
  sent_at      timestamptz,
  cancelled_at timestamptz,
  constraint remind_before_due check (remind_at <= due_at)
);

-- The sweep's only query: what is due and still owed a notification.
create index if not exists parking_timers_due_idx
  on public.parking_timers (remind_at)
  where sent_at is null and cancelled_at is null;

alter table public.parking_timers enable row level security;
-- No policies. The two functions below are the entire write surface and the
-- service role (the sweep) is the only reader. A driver has no reason to read
-- anybody's timers, including their own — the client already knows its own.
revoke all on public.parking_timers from anon, authenticated;

-- Set (or replace) the timer for this session.
--
-- Bounds are the promise the UI makes, enforced here because the UI is not the
-- thing that has to keep it:
--   at least 10 minutes  — the sweep runs every 5, so anything shorter is a
--                          reminder that may arrive after the fact
--   at most 24 hours     — past that it is not parking, it is storage, and an
--                          unbounded due_at is a row that sits here forever
create or replace function public.set_parking_timer(
  p_session_id uuid,
  p_due_at     timestamptz,
  p_warn_mins  integer default 15,
  p_label      text    default null,
  p_lat        double precision default null,
  p_lng        double precision default null
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare warn integer;
begin
  if p_session_id is null or p_due_at is null then return false; end if;
  if p_due_at < now() + interval '10 minutes' then return false; end if;
  if p_due_at > now() + interval '24 hours'   then return false; end if;

  -- The warning cannot be longer than the parking. A 15-minute warning on a
  -- 12-minute stay would want to fire before the timer was even set, which the
  -- remind_before_due check would refuse — so it is clamped, not rejected: the
  -- driver asked for a reminder and gets one.
  warn := least(greatest(coalesce(p_warn_mins, 15), 0),
                greatest(floor(extract(epoch from (p_due_at - now())) / 60)::int - 5, 0));

  insert into public.parking_timers (session_id, due_at, remind_at, label, lat, lng)
  values (p_session_id, p_due_at, p_due_at - make_interval(mins => warn),
          left(p_label, 120), p_lat, p_lng)
  on conflict (session_id) do update
    -- A replaced timer is a NEW promise: sent_at and cancelled_at are cleared
    -- so the sweep owes this driver a notification again.
    set due_at = excluded.due_at,
        remind_at = excluded.remind_at,
        label = excluded.label,
        lat = excluded.lat,
        lng = excluded.lng,
        created_at = now(),
        sent_at = null,
        cancelled_at = null;
  return true;
end $$;

revoke all on function public.set_parking_timer(uuid, timestamptz, integer, text, double precision, double precision) from public;
grant execute on function public.set_parking_timer(uuid, timestamptz, integer, text, double precision, double precision)
  to anon, authenticated;

-- Ending the session, or turning the reminder off.
--
-- Marks rather than deletes, so a driver who ends a session two minutes before
-- the sweep cannot be notified about parking they have already left — the row
-- is still there for the sweep's WHERE clause to exclude.
create or replace function public.cancel_parking_timer(p_session_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare hit integer;
begin
  if p_session_id is null then return false; end if;
  update public.parking_timers
     set cancelled_at = now()
   where session_id = p_session_id and cancelled_at is null and sent_at is null;
  get diagnostics hit = row_count;
  return hit > 0;
end $$;

revoke all on function public.cancel_parking_timer(uuid) from public;
grant execute on function public.cancel_parking_timer(uuid) to anon, authenticated;

commit;
