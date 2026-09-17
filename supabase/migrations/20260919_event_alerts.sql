-- Matchday alerts: who asked to be told, and told once.
--
-- WHAT A BANNER CANNOT DO. The home screen already carries "Tonight:
-- Anastacia · Waterfront Hall · 19:00 — park before you set off". It reaches
-- only somebody who opens the app, and the person driving to Windsor Park at
-- 18:50 did not open it. Forty thousand people went to Boucher Road on 20
-- August and ParkEasy said nothing to a single one of them.
--
-- FOLLOWED VENUES, NOT LOCATION. The obvious design is to push to everybody
-- near the ground, and it would mean storing where drivers are. This stores
-- what they asked to hear about instead: a venue key, chosen by tapping Follow
-- on that venue's page. It is explicit, it is exactly targetable, and it holds
-- nothing about anybody's movements. A driver who follows Solitude gets
-- Cliftonville home games and nothing else.
--
-- Keyed on the analytics session, the same anonymous id push_subscriptions is
-- keyed on, because a driver who wants to know about Windsor Park does not need
-- an account to want it.
--
-- TOLD ONCE, EVER, PER EVENT. event_alert_sends exists for exactly that: the
-- sweep runs hourly and the alert window is two hours wide, so without it every
-- follower gets told twice about every fixture. Twice is how somebody turns
-- notifications off, and then they hear nothing about the one that mattered.

begin;

--------------------------------------------------------------------------------
-- 1. What somebody follows
--------------------------------------------------------------------------------
create table if not exists public.event_alerts (
  session_id text        not null,
  -- The venue key from src/data/events.js (VENUES): 'windsor', 'o2',
  -- 'solitude'. Text rather than a foreign key because the venue list is in
  -- the app bundle, not the database — same reasoning as spot_reports.spot_key.
  venue      text        not null,
  -- When we know it. A guest can follow a venue; the account only matters for
  -- carrying it to another device later.
  user_id    uuid,
  created_at timestamptz not null default now(),
  primary key (session_id, venue)
);

create index if not exists event_alerts_venue_idx
  on public.event_alerts (venue);

alter table public.event_alerts enable row level security;
-- No policies. The functions below are the whole write surface and the service
-- key is the only reader: the list of who follows what is a send list, and one
-- driver has no reason to see anybody else's.
revoke all on public.event_alerts from anon, authenticated;

--------------------------------------------------------------------------------
-- 2. Who has already been told
--------------------------------------------------------------------------------
create table if not exists public.event_alert_sends (
  session_id text        not null,
  event_id   text        not null,
  sent_at    timestamptz not null default now(),
  primary key (session_id, event_id)
);

alter table public.event_alert_sends enable row level security;
revoke all on public.event_alert_sends from anon, authenticated;

-- CLAIMED, NOT CHECKED. The sweep inserts the row BEFORE it pushes and skips
-- the ones it cannot insert, so two overlapping runs cannot both send. The
-- alternative — read, then send, then record — sends twice whenever the record
-- fails, and a duplicate is the failure that costs the channel. A crash between
-- the two loses one alert instead, which is recoverable: the banner in the app
-- still says what is on. Same discipline as api/cron/parking-timers.js.
--
-- Returns the sessions this call actually claimed, so the caller pushes to
-- precisely those.
create or replace function public.claim_event_alerts(
  p_event_id text,
  p_venue    text,
  p_limit    integer default 500
) returns setof text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_event_id is null or p_venue is null then return; end if;
  return query
    with followers as (
      select a.session_id from public.event_alerts a
       where a.venue = trim(p_venue)
         -- ALREADY-TOLD FOLLOWERS ARE EXCLUDED BEFORE THE LIMIT, not after.
         -- Without this the limit picks the same first N rows on every run, the
         -- INSERT conflicts on all of them, and a venue with more followers
         -- than the limit never gets past the first N — the backlog the limit
         -- exists to spread out is the one thing it would prevent. Caught by
         -- the "next run picks up where it left off" check.
         and not exists (
           select 1 from public.event_alert_sends s
            where s.session_id = a.session_id and s.event_id = trim(p_event_id)
         )
       order by a.created_at
       limit greatest(coalesce(p_limit, 500), 1)
    )
    insert into public.event_alert_sends (session_id, event_id)
    select f.session_id, trim(p_event_id) from followers f
    on conflict (session_id, event_id) do nothing
    returning event_alert_sends.session_id;
end $$;

revoke all on function public.claim_event_alerts(text, text, integer) from public, anon, authenticated;
grant execute on function public.claim_event_alerts(text, text, integer) to service_role;

--------------------------------------------------------------------------------
-- 3. Following and unfollowing
--------------------------------------------------------------------------------
-- Returns the state after the call rather than a boolean, so the button shows
-- what the server thinks rather than what the tap assumed.
create or replace function public.set_event_alert(
  p_session_id text,
  p_venue      text,
  p_on         boolean default true
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  sid  text := nullif(trim(coalesce(p_session_id, '')), '');
  ven  text := nullif(trim(coalesce(p_venue, '')), '');
  mine integer;
begin
  -- A follow with no session cannot be delivered to anybody, so it is refused
  -- rather than stored as a row nothing will ever read.
  if sid is null or ven is null then return false; end if;
  if length(sid) > 100 or length(ven) > 60 then return false; end if;

  if not coalesce(p_on, true) then
    delete from public.event_alerts where session_id = sid and venue = ven;
    return false;
  end if;

  -- A session following forty venues is not a person with forty teams. Bounded
  -- so this cannot be used to make the sweep push to everybody.
  --
  -- The venue being followed is excluded from the count, for the same reason
  -- push_subscriptions excludes the endpoint being saved: re-following
  -- something you already follow must not be refused at the cap, or the button
  -- silently stops working for the venues you care most about.
  select count(*) into mine from public.event_alerts
   where session_id = sid and venue <> ven;
  if mine >= 20 then return false; end if;

  insert into public.event_alerts (session_id, venue, user_id)
  values (sid, ven, auth.uid())
  on conflict (session_id, venue) do update
    set user_id = coalesce(excluded.user_id, public.event_alerts.user_id);
  return true;
end $$;

revoke all on function public.set_event_alert(text, text, boolean) from public;
grant execute on function public.set_event_alert(text, text, boolean) to anon, authenticated;

--------------------------------------------------------------------------------
-- 4. What this browser follows
--------------------------------------------------------------------------------
-- The venue keys for one session, so the Follow buttons come back right after
-- a reload. Keyed on the session passed in rather than on auth.uid(), because
-- most followers have no account — which means this is readable by anybody who
-- holds a session id, and that is the same capability as holding the browser it
-- came from. Nothing here is worth more than that: it is a list of football
-- grounds.
create or replace function public.my_event_alerts(p_session_id text)
returns setof text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select venue from public.event_alerts
   where session_id = nullif(trim(coalesce(p_session_id, '')), '')
   order by created_at;
$$;

revoke all on function public.my_event_alerts(text) from public;
grant execute on function public.my_event_alerts(text) to anon, authenticated;

commit;
