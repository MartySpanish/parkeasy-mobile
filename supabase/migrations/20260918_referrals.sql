-- Referrals, and the reason they pay late.
--
-- WHAT A SIGNUP BOUNTY BUYS. Pay on signup and you are buying signups, which
-- cost nothing to manufacture: an address, a code, a tap. The accounts arrive,
-- the points go out, and the map gains nothing. Every referral scheme that has
-- ever been gamed was gamed at exactly this point.
--
-- So a referral here is recorded on signup and PAID when the invited driver
-- does something the map keeps — an approved spot, an approved photo, a report
-- that turned out right. The same rule as contribution_points: paid on
-- approval, never on submission. The referrer is paid for bringing somebody who
-- turned out to be useful, which is the only thing worth paying for.
--
-- WHAT IT COSTS, honestly. 50 points to the referrer and 25 to the invited
-- driver is 75 points, and 100 points is 30 days of Premium at a list price of
-- £29/year — so about £1.79 of list price for one activated contributor. It is
-- cheap because the currency is a thing we already own; see docs/points.md.
--
-- ONE REFERRAL PER INVITED DRIVER, EVER. Unique on invitee_id, so an account
-- cannot be walked round a circle of friends. And never yourself: the check
-- constraint is on the table, not in the function, because a rule that only
-- exists in a function is a rule that a later function forgets.

begin;

--------------------------------------------------------------------------------
-- 1. The code
--------------------------------------------------------------------------------
-- One per driver, generated on first ask rather than for all 1,400 accounts at
-- once — most will never look.
--
-- SIX CHARACTERS FROM AN ALPHABET WITH NO CONFUSABLES. This code gets read out
-- in a car park and typed on a phone keyboard, so I, L, O, S, 0, 1 and 5 are
-- all left out — one of each pair people read as the other. That is not
-- fussiness: a mistyped code is a referral that silently goes to nobody, and
-- the driver who mistyped it has no way to find out.
--
-- The alphabet is SPELLED OUT rather than written as ranges. The first version
-- of this file used a range that quietly included L and S while looking
-- careful, and the test caught it. A range here is not worth the risk of being
-- read as correct.
--
-- 29 characters, six long: about 594 million codes.
create table if not exists public.referral_codes (
  user_id    uuid        primary key references auth.users(id) on delete cascade,
  code       text        not null unique,
  created_at timestamptz not null default now(),
  constraint referral_codes_shape check (code ~ '^[ABCDEFGHJKMNPQRTUVWXYZ2346789]{6}$')
);

alter table public.referral_codes enable row level security;
revoke all on public.referral_codes from anon, authenticated;
-- A driver reads their own code through the function below. The table is not
-- readable, because the full list of codes is the one thing that would let
-- somebody attribute their own signups to a stranger at random.

--------------------------------------------------------------------------------
-- 2. The referral
--------------------------------------------------------------------------------
create table if not exists public.referrals (
  id           uuid primary key default gen_random_uuid(),
  referrer_id  uuid not null references auth.users(id) on delete cascade,
  -- ONE ROW PER INVITED DRIVER, EVER. Not per (referrer, invitee): an account
  -- cannot be walked round a circle of friends collecting a bounty each time.
  invitee_id   uuid not null references auth.users(id) on delete cascade unique,
  code         text not null,
  created_at   timestamptz not null default now(),
  -- Set when the invited driver does something the map keeps. Null means
  -- recorded but unpaid, which is most of them and is fine.
  qualified_at timestamptz,
  -- What they did. Kept so a referral that paid can be explained a year later.
  qualified_by text,
  constraint referrals_not_self check (referrer_id <> invitee_id)
);

create index if not exists referrals_referrer_idx
  on public.referrals (referrer_id, created_at desc);
create index if not exists referrals_pending_idx
  on public.referrals (invitee_id) where qualified_at is null;

alter table public.referrals enable row level security;
revoke all on public.referrals from anon, authenticated;

-- A driver may read the referrals they made. Not the ones pointing AT them:
-- whose code somebody used is between that person and us, and a driver seeing
-- "you were referred by Dave" is a small privacy leak with no purpose.
drop policy if exists referrals_own_read on public.referrals;
create policy referrals_own_read on public.referrals
  for select using (referrer_id = auth.uid());
grant select on public.referrals to authenticated;

--------------------------------------------------------------------------------
-- 3. The tariff
--------------------------------------------------------------------------------
create or replace function public.referral_points(p_side text)
returns integer
language sql immutable
as $$
  select case p_side
    -- The referrer did the persuading, which is the part that is actually hard.
    when 'referrer' then 50
    -- A welcome, on top of what the new driver earns for the contribution
    -- itself. Half, because they were going to be paid for that anyway.
    when 'invitee'  then 25
    else 0
  end;
$$;

--------------------------------------------------------------------------------
-- 4. Getting your code
--------------------------------------------------------------------------------
-- Generated on demand and then stable forever, because it goes in messages and
-- on paper. Collisions are retried rather than ignored: 29^6 is about 594
-- million codes, so a clash is vanishingly unlikely — and silently handing two
-- drivers the same code would send one of them's referrals to the other.
create or replace function public.my_referral_code()
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid  uuid := auth.uid();
  v_code text;
  v_try  integer := 0;
begin
  if v_uid is null then return null; end if;

  select code into v_code from public.referral_codes where user_id = v_uid;
  if v_code is not null then return v_code; end if;

  loop
    v_try := v_try + 1;
    -- Six characters from the confusable-free alphabet.
    select string_agg(substr('ABCDEFGHJKMNPQRTUVWXYZ2346789',
                             1 + floor(random() * 29)::int, 1), '')
      into v_code from generate_series(1, 6);

    begin
      insert into public.referral_codes (user_id, code) values (v_uid, v_code);
      return v_code;
    exception
      when unique_violation then
        -- Either the code is taken, or this driver asked twice at once. The
        -- second is the common case and is not an error.
        select code into v_code from public.referral_codes where user_id = v_uid;
        if v_code is not null then return v_code; end if;
        if v_try >= 5 then return null; end if;
    end;
  end loop;
end $$;

revoke all on function public.my_referral_code() from public, anon;
grant execute on function public.my_referral_code() to authenticated;

--------------------------------------------------------------------------------
-- 5. Claiming one
--------------------------------------------------------------------------------
-- Called once, by a newly signed-in driver, with the code they arrived on.
-- Records the referral; pays nobody. Returns a reason rather than a boolean so
-- the app can tell somebody why their friend's code did not take — "already
-- claimed" and "that is your own code" are different sentences and both are
-- more use than a silent failure.
--
-- WHY "NEW ACCOUNT" IS CHECKED AND WHAT IT MEANS HERE. An account that has
-- already contributed or already been referred is not somebody's referral, it
-- is an existing driver typing a friend's code. Paying for that is paying for
-- nothing, so it is refused — and said plainly rather than accepted quietly.
create or replace function public.claim_referral(p_code text)
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid     uuid := auth.uid();
  v_code    text := upper(trim(coalesce(p_code, '')));
  v_owner   uuid;
begin
  if v_uid is null then
    return json_build_object('ok', false, 'reason', 'signed_out');
  end if;
  if v_code !~ '^[ABCDEFGHJKMNPQRTUVWXYZ2346789]{6}$' then
    return json_build_object('ok', false, 'reason', 'bad_code');
  end if;

  select user_id into v_owner from public.referral_codes where code = v_code;
  if v_owner is null then
    return json_build_object('ok', false, 'reason', 'unknown_code');
  end if;
  if v_owner = v_uid then
    return json_build_object('ok', false, 'reason', 'own_code');
  end if;

  if exists (select 1 from public.referrals where invitee_id = v_uid) then
    return json_build_object('ok', false, 'reason', 'already_referred');
  end if;
  -- Already an active contributor, so nobody brought them here.
  if exists (select 1 from public.contribution_points
              where user_id = v_uid and points > 0) then
    return json_build_object('ok', false, 'reason', 'not_new');
  end if;

  insert into public.referrals (referrer_id, invitee_id, code)
  values (v_owner, v_uid, v_code)
  on conflict (invitee_id) do nothing;

  return json_build_object('ok', true, 'reason', 'recorded');
end $$;

revoke all on function public.claim_referral(text) from public, anon;
grant execute on function public.claim_referral(text) to authenticated;

--------------------------------------------------------------------------------
-- 6. Paying it, when the invited driver turns out to be real
--------------------------------------------------------------------------------
-- Called by the admin API from the same place contribution points are awarded:
-- the moment a human approves something. Pays both sides once, through
-- award_points(), so the ledger is the single account of every point in the
-- system and a referral cannot be paid twice however many times this is called.
--
-- service_role only. A driver who could call this could qualify their own
-- referrals, which is the whole thing this file is built to prevent.
create or replace function public.qualify_referral(
  p_invitee_id uuid,
  p_because    text default null
) returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.referrals;
  v_ref integer := 0;
  v_inv integer := 0;
begin
  if p_invitee_id is null then
    return json_build_object('ok', false, 'reason', 'no_invitee');
  end if;

  select * into v_row from public.referrals
   where invitee_id = p_invitee_id and qualified_at is null
   for update;
  if not found then
    -- No referral, or already paid. Neither is an error: this is called on
    -- every approval and most approvals are not referrals.
    return json_build_object('ok', false, 'reason', 'nothing_pending');
  end if;

  update public.referrals
     set qualified_at = now(),
         qualified_by = nullif(left(trim(coalesce(p_because, '')), 100), '')
   where id = v_row.id;

  -- Through award_points, not by writing rows: the cap, the idempotency and the
  -- ledger's shape all live there, and a second way into the ledger is a second
  -- set of rules to keep in step.
  v_ref := public.award_points(v_row.referrer_id, 'referral_paid', v_row.invitee_id::text);
  v_inv := public.award_points(p_invitee_id,      'referral_bonus', v_row.referrer_id::text);

  return json_build_object('ok', true, 'referrer_points', v_ref, 'invitee_points', v_inv);
end $$;

revoke all on function public.qualify_referral(uuid, text) from public, anon, authenticated;
grant execute on function public.qualify_referral(uuid, text) to service_role;

--------------------------------------------------------------------------------
-- 7. The tariff, in the one place that pays
--------------------------------------------------------------------------------
-- point_value() is extended rather than bypassed, so there is still exactly one
-- table of prices in the system. The two referral kinds are deliberately NOT
-- reachable from the app: award_points() is service_role only, and the only
-- caller that passes these kinds is qualify_referral(), which itself only fires
-- on an approval.
create or replace function public.point_value(p_kind text)
returns integer
language sql immutable
as $$
  select case p_kind
    when 'spot_approved'    then 25
    when 'photo_approved'   then 10
    when 'report_accurate'  then 15
    when 'signal'           then 1
    -- Paid to the referrer when their invited driver's first contribution is
    -- accepted. Never on signup — see the header.
    when 'referral_paid'    then public.referral_points('referrer')
    when 'referral_bonus'   then public.referral_points('invitee')
    else 0
  end;
$$;

--------------------------------------------------------------------------------
-- 8. What a driver sees
--------------------------------------------------------------------------------
-- Their code, how many they have brought, and how many of those turned out to
-- be real. Both numbers, because the difference between them is the honest
-- story: "4 joined, 2 counted" is true and useful, and showing only the first
-- would imply points that are not coming.
create or replace function public.my_referrals()
returns json
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid       uuid := auth.uid();
  v_joined    integer;
  v_qualified integer;
begin
  if v_uid is null then
    return json_build_object('signed_in', false, 'code', null,
                             'joined', 0, 'qualified', 0,
                             'points_each', public.referral_points('referrer'));
  end if;
  select count(*), count(qualified_at) into v_joined, v_qualified
    from public.referrals where referrer_id = v_uid;

  return json_build_object(
    'signed_in',   true,
    'code',        (select code from public.referral_codes where user_id = v_uid),
    'joined',      v_joined,
    'qualified',   v_qualified,
    'points_each', public.referral_points('referrer'),
    'bonus_each',  public.referral_points('invitee')
  );
end $$;

revoke all on function public.my_referrals() from public;
grant execute on function public.my_referrals() to anon, authenticated;

commit;
