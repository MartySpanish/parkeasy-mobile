-- Community reporting, part two: "Confirmed by 0 drivers".
--
-- WHAT IS ON SCREEN TODAY. Every spot detail sheet in the app carries a green
-- tick and the line "Confirmed by 0 drivers", because `votes` is a field in the
-- seed data and every one of the 744 spots has it set to 0. Under it are two
-- buttons, "👍 Still here" and "👎 Changed":
--
--   * Still here writes `pe_votes` in localStorage. The count then reads
--     "Confirmed by 1 driver" — on that phone, forever, for nobody else. The
--     next driver to open the same spot still sees 0.
--   * Changed writes `pe_ratings` in localStorage and goes nowhere at all. A
--     driver taps the thumbs-down to warn people and nothing whatsoever
--     happens, which is worse than the Report button sitting beside it.
--
-- So the app asks half a million drivers a year for the single most valuable
-- thing they can give it — "is this still true?" — and throws every answer
-- away. This migration is where the answers go.
--
-- ONE ROW PER SOURCE PER SPOT, and that is the whole design.
--
-- The primary key is (spot_key, source_id), so a driver's latest answer
-- REPLACES their previous one. Tapping Still here fifty times is one
-- confirmation; changing your mind from Still here to Changed moves the vote
-- rather than adding to both sides. A count that can be inflated by tapping is
-- not a count, it is a dare.
--
-- source_id is the analytics session id — the same anonymous id
-- push_subscriptions is keyed on. Not the account: the driver standing at the
-- spot usually has no account, and demanding one to answer "is this still
-- there?" is how you get no answers.
--
-- WHY A FUNCTION RATHER THAN AN INSERT POLICY. Same reason as app_events and
-- push_subscriptions: a table that feeds what other drivers are shown is a
-- table somebody will try to fill. The function validates the shape, caps how
-- many spots one source may vote on, and takes user_id from auth.uid() so a
-- signal cannot be attributed to somebody else's account.
--
-- AND THE SAME BUG IN THE REPORT COUNT. spot_report_counts counts ROWS, and
-- the flag beside a spot says "N drivers reported a problem here recently". One
-- person tapping Report five times was five drivers. Reports are now keyed on
-- the source too, and the count is of distinct reporters.

begin;

--------------------------------------------------------------------------------
-- 1. The signals
--------------------------------------------------------------------------------
create table if not exists public.spot_signals (
  -- Text, not a foreign key: the map mixes community submissions (uuid) with
  -- the curated seed data in src/*.js (integer ids), and a driver confirming a
  -- seeded spot is exactly as useful as one confirming a submitted spot. Same
  -- reasoning as spot_reports.spot_key.
  spot_key   text        not null,
  source_id  text        not null,
  signal     text        not null check (signal in ('confirmed','changed')),
  -- When we know it. A guest's answer counts the same; this is only so a
  -- signed-in driver's history is theirs.
  user_id    uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (spot_key, source_id)
);

create index if not exists spot_signals_spot_idx
  on public.spot_signals (spot_key, signal);
-- The cap below counts a source's rows, and the sweep-style reads are by recency.
create index if not exists spot_signals_source_idx
  on public.spot_signals (source_id, updated_at desc);

alter table public.spot_signals enable row level security;
-- No policies. The two functions below are the whole write surface, and the
-- view is the whole read surface: the raw table says which anonymous source
-- said what about which spot, which is a movement history and nobody's
-- business. Counts are public; the rows are not.
revoke all on public.spot_signals from anon, authenticated;

--------------------------------------------------------------------------------
-- 2. What the app is allowed to read
--------------------------------------------------------------------------------
-- Counts only. Never a source id, never a user id, never who said what — the
-- line beside a spot is "eleven drivers confirmed this in the last month", not
-- a list of people and where they parked.
--
-- Both an all-time and a 30-day count, because they answer different questions:
-- all-time is how well known a spot is, and 30 days is whether it is still
-- true. The UI leads with the recent one.
create or replace view public.spot_signal_counts
with (security_invoker = false) as
select
  spot_key,
  count(*) filter (where signal = 'confirmed')                                     as confirmed,
  count(*) filter (where signal = 'changed')                                       as changed,
  count(*) filter (where signal = 'confirmed' and updated_at > now() - interval '30 days') as confirmed_30d,
  count(*) filter (where signal = 'changed'   and updated_at > now() - interval '30 days') as changed_30d,
  max(updated_at) filter (where signal = 'confirmed')                              as last_confirmed_at,
  max(updated_at) filter (where signal = 'changed')                                as last_changed_at
from public.spot_signals
group by spot_key;

-- Revoked before granted, and not for tidiness. Supabase's default privileges
-- grant ALL on every new relation in public — views included — to anon and
-- authenticated, so a bare `grant select` here would be a no-op and this view
-- would also carry anon INSERT/UPDATE/DELETE. Stating both makes the privilege
-- what this file says it is rather than whatever the project default happens
-- to be, and lets the test assert SELECT and only SELECT.
revoke all on public.spot_signal_counts from anon, authenticated;
grant select on public.spot_signal_counts to anon, authenticated;

comment on view public.spot_signal_counts is
  'Per-spot confirm/changed counts for the detail sheet. Counts only — never a '
  'source id or a user id, which together would be a movement history. One row '
  'per source per spot in the underlying table, so these cannot be inflated by '
  'tapping.';

--------------------------------------------------------------------------------
-- 3. Casting one
--------------------------------------------------------------------------------
-- Returns the fresh counts rather than a boolean, so the UI shows the server's
-- number instead of incrementing its own guess. The old code did the guessing,
-- which is exactly why "Confirmed by 1 driver" could be true on one phone and
-- false everywhere else.
create or replace function public.set_spot_signal(
  p_spot_key  text,
  p_source_id text,
  p_signal    text
) returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  src   text;
  mine  integer;
  out_r record;
begin
  if p_spot_key is null or length(trim(p_spot_key)) = 0 or length(p_spot_key) > 100 then
    return null;
  end if;
  if p_signal is null or p_signal not in ('confirmed','changed') then
    return null;
  end if;

  -- A caller with no session id gets a fresh one per call, so each of its taps
  -- is its own source. That is the honest reading: we cannot tell whether two
  -- unidentified taps are two people, and counting them as one would throw
  -- away a real driver's answer.
  src := coalesce(nullif(trim(p_source_id), ''), gen_random_uuid()::text);
  if length(src) > 100 then return null; end if;

  -- One source voting on three hundred spots is not a person walking around
  -- Belfast. Bounded so this cannot be used to paint the map.
  --
  -- The spot being voted on is excluded from the count, for the same reason
  -- push_subscriptions excludes the endpoint being saved: a driver at the cap
  -- who CHANGES an existing answer must not be refused, because refusing them
  -- silently freezes a wrong answer in place. The cap stops new rows piling
  -- up, not an existing row being corrected.
  select count(*) into mine from public.spot_signals
   where source_id = src and spot_key <> p_spot_key;
  if mine >= 200 then return null; end if;

  insert into public.spot_signals (spot_key, source_id, signal, user_id)
  values (trim(p_spot_key), src, p_signal, auth.uid())
  on conflict (spot_key, source_id) do update
    -- Their latest answer replaces their previous one. created_at is left
    -- alone: it records when this driver first said anything about this spot.
    set signal = excluded.signal,
        user_id = coalesce(excluded.user_id, public.spot_signals.user_id),
        updated_at = now();

  select * into out_r from public.spot_signal_counts where spot_key = trim(p_spot_key);
  return json_build_object(
    'spot_key',    trim(p_spot_key),
    'confirmed',   coalesce(out_r.confirmed, 0),
    'changed',     coalesce(out_r.changed, 0),
    'confirmed_30d', coalesce(out_r.confirmed_30d, 0),
    'changed_30d',   coalesce(out_r.changed_30d, 0),
    'mine',        p_signal
  );
end $$;

revoke all on function public.set_spot_signal(text, text, text) from public;
grant execute on function public.set_spot_signal(text, text, text) to anon, authenticated;

-- Untapping. A driver who confirmed by accident can take it back, and taking it
-- back removes the row rather than storing a third kind of signal: "no opinion"
-- is the absence of one.
create or replace function public.clear_spot_signal(
  p_spot_key  text,
  p_source_id text
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare hit integer;
begin
  if p_spot_key is null or p_source_id is null or trim(p_source_id) = '' then
    return false;
  end if;
  delete from public.spot_signals
   where spot_key = trim(p_spot_key) and source_id = trim(p_source_id);
  get diagnostics hit = row_count;
  return hit > 0;
end $$;

revoke all on function public.clear_spot_signal(text, text) from public;
grant execute on function public.clear_spot_signal(text, text) to anon, authenticated;

--------------------------------------------------------------------------------
-- 4. Reports: a count of people, not of taps
--------------------------------------------------------------------------------
alter table public.spot_reports
  add column if not exists source_id text;

comment on column public.spot_reports.source_id is
  'The reporting browser''s analytics session. Present so the flag can count '
  'distinct reporters: it used to count rows, and one person tapping Report '
  'five times read as "5 drivers reported a problem here recently".';

-- One OPEN report per source per spot. Resolved ones are left alone: a spot
-- that was reported, checked, and has gone wrong again is a second report, and
-- collapsing those two would hide the history that makes a spot worth pulling.
create unique index if not exists spot_reports_open_per_source_idx
  on public.spot_reports (spot_key, source_id)
  where resolved_at is null and source_id is not null;

-- The report write surface, matching the rest of the schema. The direct INSERT
-- policy it replaces had no shape check, no cap and no dedupe.
create or replace function public.report_spot(
  p_spot_key  text,
  p_source_id text,
  p_reason    text,
  p_note      text default null
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  src  text;
  mine integer;
begin
  if p_spot_key is null or length(trim(p_spot_key)) = 0 or length(p_spot_key) > 100 then
    return false;
  end if;
  -- The reason list is the one the sheet offers. An unknown reason becomes
  -- 'wrong' rather than a refusal: a driver who has taken the trouble to
  -- report something must not lose it to a renamed constant.
  if p_reason is null or p_reason not in ('wrong','gone','restricted','full_always','other') then
    p_reason := 'wrong';
  end if;

  src := coalesce(nullif(trim(p_source_id), ''), gen_random_uuid()::text);
  if length(src) > 100 then return false; end if;

  select count(*) into mine from public.spot_reports
   where source_id = src and resolved_at is null and spot_key <> trim(p_spot_key);
  if mine >= 100 then return false; end if;

  insert into public.spot_reports (spot_key, source_id, reporter_id, reason, note)
  values (trim(p_spot_key), src, auth.uid(), p_reason,
          nullif(left(trim(coalesce(p_note, '')), 500), ''))
  on conflict (spot_key, source_id) where resolved_at is null and source_id is not null
    -- A second tap is a correction, not a second reporter. The newer reason and
    -- note win; created_at stays, because when they FIRST said so is what the
    -- review queue sorts on.
    do update set reason = excluded.reason,
                  note = coalesce(excluded.note, public.spot_reports.note),
                  reporter_id = coalesce(excluded.reporter_id, public.spot_reports.reporter_id);

  return true;
end $$;

revoke all on function public.report_spot(text, text, text, text) from public;
grant execute on function public.report_spot(text, text, text, text) to anon, authenticated;

-- The direct insert is withdrawn now that the function exists. Keeping both
-- would leave the ungated path open, which is the same as not having done this.
drop policy if exists spot_reports_insert on public.spot_reports;
revoke all on public.spot_reports from anon, authenticated;

-- Rebuilt for distinct reporters. Dropped rather than replaced because the
-- column list changes, and CASCADE is not used: nothing else depends on it, and
-- a silent cascade would be how a dependent view disappears.
drop view if exists public.spot_report_counts;
create view public.spot_report_counts
with (security_invoker = false) as
select
  spot_key,
  -- A count of rows that is nonetheless a count of people, because
  -- spot_reports_open_per_source_idx allows one OPEN row per reporter per spot
  -- and report_spot() updates it rather than adding a second. The first
  -- version of this fix counted DISTINCT sources as well, which reads as
  -- careful and is in fact unobservable: with that index in place the two can
  -- never differ, so it was a guarantee no test could hold. The index is what
  -- is tested.
  --
  -- A row from before source_id existed is its own reporter either way; two
  -- unattributed taps cannot be told apart and counting them as one would
  -- throw away a real driver's report.
  count(*)                                                           as reports,
  max(created_at)                                                    as last_reported_at,
  count(*) filter (where created_at > now() - interval '30 days')     as reports_30d
from public.spot_reports
where resolved_at is null
group by spot_key;

revoke all on public.spot_report_counts from anon, authenticated;
grant select on public.spot_report_counts to anon, authenticated;

comment on view public.spot_report_counts is
  'Open report counts per spot, for the "recently reported" flag. Distinct '
  'one row per open reporter, enforced by spot_reports_open_per_source_idx: '
  'it counted every row until 17 Sep 2026, so one person '
  'tapping Report five times read as five drivers. Counts only — never the '
  'reporter or the note, which are for the review queue.';

--------------------------------------------------------------------------------
-- 5. Closing a report
--------------------------------------------------------------------------------
-- Nothing could resolve a report, so a spot that was checked and found fine
-- stayed flagged to every driver for good. The flag is the useful half of
-- reporting and an unclearable flag destroys it: after a year everything is
-- flagged and the warning means nothing.
--
-- service_role only. Resolving is a decision a human makes after looking, and
-- the admin API already holds the service key.
create or replace function public.resolve_spot_reports(
  p_spot_key   text,
  p_resolution text default null
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare hit integer;
begin
  if p_spot_key is null then return 0; end if;
  update public.spot_reports
     set resolved_at = now(),
         resolution = nullif(left(trim(coalesce(p_resolution, '')), 300), '')
   where spot_key = trim(p_spot_key) and resolved_at is null;
  get diagnostics hit = row_count;
  return hit;
end $$;

revoke all on function public.resolve_spot_reports(text, text) from public;
grant execute on function public.resolve_spot_reports(text, text) to service_role;

commit;
