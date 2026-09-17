-- Points, and the only reward this app can honestly pay.
--
-- WHAT THE PRODUCT IS MADE OF. ParkEasy's 744 spots, 89 gems, the photos and
-- the restriction notes all came from drivers. Nothing has ever thanked them
-- for it. The one existing gesture is a code called SPOT-THANKS that the
-- founder types in by hand.
--
-- WHY POINTS CONVERT TO PREMIUM DAYS AND NOTHING ELSE. A balance that buys
-- nothing is a number, and a number a company invents to thank you with is
-- worth what it costs to print. Premium already exists, already has a price,
-- and is already granted by writing a promo_redemptions row — see
-- has_premium(). So a point is a claim on something real, and this ledger
-- cannot be inflated without giving away something that would otherwise have
-- been sold. That is the property that keeps the tariff honest.
--
-- Cash is deliberately not on the table. Paying drivers per contribution turns
-- 744 curated spots into a piecework queue, and the accuracy of those spots IS
-- the product.
--
-- THE ONE RULE THAT MATTERS: PAID ON APPROVAL, NEVER ON SUBMISSION.
--
-- Points for submitting a spot pay for junk, and a queue of junk is how the
-- moderation that keeps the map accurate stops being possible. Every kind below
-- is either awarded by a human approving the thing (spot_approved,
-- photo_approved, report_accurate) or capped per day at a value low enough that
-- farming it is not worth the thumb movement (signal).
--
-- WHO AWARDS. Nobody but the service role. There is no path from the app to
-- award_points(); the admin API calls it when a human approves something. A
-- self-award function is a mint.

begin;

--------------------------------------------------------------------------------
-- 1. The ledger
--------------------------------------------------------------------------------
-- Append-only rows rather than a balance column. A balance column is one number
-- that can disagree with its own history, and the first time it does there is no
-- way to tell which is right. Here the balance is a sum, a spend is a negative
-- row, and the history is the audit.
create table if not exists public.contribution_points (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users(id) on delete cascade,
  kind       text        not null,
  -- What it was for: a submission id, a photo id, a spot key, or the timestamp
  -- of a spend. Part of the unique key, so the same act cannot be paid twice
  -- however many times an admin taps approve or a webhook retries.
  ref        text        not null,
  points     integer     not null,
  created_at timestamptz not null default now(),
  constraint contribution_points_once unique (user_id, kind, ref)
);

create index if not exists contribution_points_user_idx
  on public.contribution_points (user_id, created_at desc);
-- The daily cap counts one driver's rows of one kind by recency.
create index if not exists contribution_points_cap_idx
  on public.contribution_points (user_id, kind, created_at desc);

alter table public.contribution_points enable row level security;
revoke all on public.contribution_points from anon, authenticated;

-- A driver may read their own ledger, and that is the only read there is. It is
-- their record of what they gave. There is deliberately no leaderboard: a
-- thank-you turned into a competition is how a map about accuracy fills up with
-- volume.
drop policy if exists contribution_points_own_read on public.contribution_points;
create policy contribution_points_own_read on public.contribution_points
  for select using (user_id = auth.uid());
grant select on public.contribution_points to authenticated;

--------------------------------------------------------------------------------
-- 2. The tariff, in one place
--------------------------------------------------------------------------------
-- Functions rather than a table: these are a product decision that changes by
-- deploy, and a table of them is a table somebody can edit to mint points.
--
-- The shape of the numbers IS the policy. A spot that survives review is worth
-- twenty-five confirmation taps, because writing down a restriction correctly is
-- twenty-five times the work and considerably more than twenty-five times the
-- value: a wrong restriction is a £90 ticket.
create or replace function public.point_value(p_kind text)
returns integer
language sql immutable
as $$
  select case p_kind
    -- Awarded when a human approves the submission. Never on submit.
    when 'spot_approved'    then 25
    -- A photo is the answer to "is this it?" from a car in the dark.
    when 'photo_approved'   then 10
    -- A report that turned out to be right, decided when it is resolved.
    when 'report_accurate'  then 15
    -- Still here / Changed. Capped; see point_daily_cap().
    when 'signal'           then 1
    else 0
  end;
$$;

-- How much of a capped kind one driver may be paid for in a day. null = no cap,
-- which is safe only for the kinds a human has to approve.
create or replace function public.point_daily_cap(p_kind text)
returns integer
language sql immutable
as $$
  select case p_kind when 'signal' then 5 else null end;
$$;

-- 100 points for 30 days: a lot of taps, or four accepted spots. The tariff is
-- meant to make contributing something reviewed the fast route and tapping the
-- slow one.
create or replace function public.point_reward_cost() returns integer
language sql immutable as $$ select 100 $$;
create or replace function public.point_reward_days() returns integer
language sql immutable as $$ select 30 $$;

--------------------------------------------------------------------------------
-- 3. Awarding
--------------------------------------------------------------------------------
-- Returns the points actually awarded: 0 when the act was already paid, the
-- kind is unknown, the user is gone, or the daily cap is reached. Never raises
-- — an approval must not fail because the thank-you did.
create or replace function public.award_points(
  p_user_id uuid,
  p_kind    text,
  p_ref     text
) returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_value integer;
  v_cap   integer;
  v_today integer;
  v_hit   integer;
begin
  if p_user_id is null or p_kind is null or p_ref is null or trim(p_ref) = '' then
    return 0;
  end if;

  v_value := public.point_value(p_kind);
  if v_value <= 0 then return 0; end if;

  -- An award must never reach a user row that is not there: the foreign key
  -- would raise and take the approval down with it. A submission from an
  -- account since deleted is exactly that case.
  if not exists (select 1 from auth.users where id = p_user_id) then return 0; end if;

  v_cap := public.point_daily_cap(p_kind);
  if v_cap is not null then
    select coalesce(sum(points), 0) into v_today
      from public.contribution_points
     where user_id = p_user_id and kind = p_kind
       and created_at > now() - interval '24 hours';
    if v_today >= v_cap then return 0; end if;
  end if;

  insert into public.contribution_points (user_id, kind, ref, points)
  values (p_user_id, p_kind, trim(p_ref), v_value)
  on conflict (user_id, kind, ref) do nothing;

  -- FOUND after an INSERT ... DO NOTHING is not reliable across versions for
  -- "did a row land"; the row count is.
  get diagnostics v_hit = row_count;
  if v_hit = 0 then return 0; end if;
  return v_value;
end $$;

revoke all on function public.award_points(uuid, text, text) from public, anon, authenticated;
grant execute on function public.award_points(uuid, text, text) to service_role;

--------------------------------------------------------------------------------
-- 4. What a driver sees
--------------------------------------------------------------------------------
-- Their balance and what it is worth, in one call. Zeros rather than nulls for
-- a driver who has contributed nothing, so the UI always has a number and never
-- prints "null points".
create or replace function public.my_points()
returns json
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid    uuid := auth.uid();
  v_earned integer;
  v_spent  integer;
  v_cost   integer := public.point_reward_cost();
  v_days   integer := public.point_reward_days();
begin
  if v_uid is null then
    return json_build_object('signed_in', false, 'earned', 0, 'spent', 0,
                             'balance', 0, 'cost', v_cost, 'days', v_days,
                             'can_redeem', false);
  end if;
  select coalesce(sum(points) filter (where points > 0), 0),
         coalesce(-sum(points) filter (where points < 0), 0)
    into v_earned, v_spent
    from public.contribution_points where user_id = v_uid;

  return json_build_object(
    'signed_in',  true,
    'earned',     v_earned,
    'spent',      v_spent,
    'balance',    v_earned - v_spent,
    'cost',       v_cost,
    'days',       v_days,
    'can_redeem', (v_earned - v_spent) >= v_cost
  );
end $$;

revoke all on function public.my_points() from public;
grant execute on function public.my_points() to anon, authenticated;

--------------------------------------------------------------------------------
-- 5. Spending it
--------------------------------------------------------------------------------
-- WHY THE LOCK. Two taps on Redeem half a second apart are two transactions,
-- and both would read a balance of 100 before either wrote its spend — sixty
-- days for a hundred points. The unique constraint cannot help, because two
-- spends by one driver are legitimately two rows. An advisory lock keyed on the
-- driver makes them one at a time.
--
-- WHY PREMIUM IS EXTENDED RATHER THAN INSERTED. promo_redemptions is UNIQUE on
-- (user_id, code), so a second redemption under the same code would violate it
-- — and extending is the right behaviour anyway: redeeming twice should be
-- sixty days, not thirty overwritten with thirty. Extended from the LATER of
-- now() and the current expiry, so a driver who redeems mid-subscription has
-- their days added on the end rather than swallowed.
create or replace function public.redeem_points()
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_email   text := auth.jwt() ->> 'email';
  v_cost    integer := public.point_reward_cost();
  v_days    integer := public.point_reward_days();
  v_balance integer;
  v_until   timestamptz;
begin
  if v_uid is null then
    return json_build_object('ok', false, 'reason', 'signed_out');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));

  select coalesce(sum(points), 0) into v_balance
    from public.contribution_points where user_id = v_uid;
  if v_balance < v_cost then
    return json_build_object('ok', false, 'reason', 'not_enough',
                             'balance', v_balance, 'cost', v_cost);
  end if;

  insert into public.promo_redemptions (user_id, user_email, code, expires_at)
  values (v_uid, v_email, 'POINTS', now() + make_interval(days => v_days))
  on conflict (user_id, code) do update
    set expires_at = greatest(public.promo_redemptions.expires_at, now())
                     + make_interval(days => v_days),
        user_email = coalesce(excluded.user_email, public.promo_redemptions.user_email)
  returning expires_at into v_until;

  -- The spend, as a ledger row. `ref` carries the moment, so redeeming again
  -- next month is a second row rather than a unique violation, and the history
  -- reads as a statement.
  insert into public.contribution_points (user_id, kind, ref, points)
  values (v_uid, 'redeemed', to_char(clock_timestamp(), 'YYYY-MM-DD"T"HH24:MI:SS.US'), -v_cost);

  return json_build_object('ok', true, 'days', v_days, 'until', v_until,
                           'balance', v_balance - v_cost, 'cost', v_cost);
end $$;

revoke all on function public.redeem_points() from public, anon;
grant execute on function public.redeem_points() to authenticated;

commit;
