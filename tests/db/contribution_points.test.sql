-- A ledger, and the ways a points system becomes a lie.
--
-- Four of them, and each has its own section below:
--
--   * paying for the act of submitting rather than for something accepted,
--     which funds a queue of junk and ends the moderation that keeps the map
--     accurate;
--   * paying the same act twice, because an admin tapped approve twice or a
--     webhook retried;
--   * letting a driver award themselves;
--   * two taps on Redeem spending the same hundred points twice.
--
-- The fourth is the one that costs money, and it cannot be tested from a single
-- psql session — the race only exists between connections. It has its own file,
-- tests/db/points_concurrency.sh, which fires eight simultaneous redeems at one
-- reward's worth of points. Without the advisory lock in redeem_points() that
-- run grants three rewards, ninety days, and a balance of minus two hundred.
\set ON_ERROR_STOP on
set client_min_messages = notice;

create or replace function assert(p_cond boolean, p_what text)
returns void language plpgsql as $$
begin
  if p_cond then raise notice '  PASS  %', p_what;
  else raise exception 'FAIL  %', p_what;
  end if;
end $$;

insert into auth.users (id, email) values
  ('dddd0000-0000-0000-0000-000000000001', 'giver@test.local'),
  ('dddd0000-0000-0000-0000-000000000002', 'taker@test.local')
  on conflict do nothing;

--------------------------------------------------------------------------------
\echo ''
\echo '1. Nobody can award themselves'
--------------------------------------------------------------------------------
select assert(relrowsecurity, 'row level security is on')
  from pg_class where oid = 'public.contribution_points'::regclass;

-- A self-award function is a mint, so there is no path from the app to one.
select assert(not has_function_privilege('anon', 'public.award_points(uuid,text,text)', 'execute'),
  'anon cannot award points');
select assert(not has_function_privilege('authenticated', 'public.award_points(uuid,text,text)', 'execute'),
  'a signed-in driver cannot award points');
select assert(has_function_privilege('service_role', 'public.award_points(uuid,text,text)', 'execute'),
  'the admin API can, when a human approves something');

-- And no direct write either, or the function is decoration.
select assert(count(*) = 0, 'anon and authenticated cannot INSERT or UPDATE the ledger')
  from information_schema.role_table_grants
 where table_name = 'contribution_points'
   and grantee in ('anon', 'authenticated')
   and privilege_type in ('INSERT', 'UPDATE', 'DELETE');

select assert(count(*) = 1, 'the only policy on the ledger is a driver reading their own')
  from pg_policies where tablename = 'contribution_points';
select assert(cmd = 'SELECT', 'and it is a read policy')
  from pg_policies where tablename = 'contribution_points';

select assert(
  (select prosecdef from pg_proc where oid = v.fn::regprocedure)
  and (select proconfig::text like '%search_path=public, pg_temp%'
         from pg_proc where oid = v.fn::regprocedure),
  v.fn || ' is SECURITY DEFINER with a pinned search_path')
 from (values ('public.award_points(uuid,text,text)'),
              ('public.my_points()'),
              ('public.redeem_points()')) v(fn);

--------------------------------------------------------------------------------
\echo ''
\echo '2. The tariff pays for accepted work, not for submitting'
--------------------------------------------------------------------------------
-- The kinds that carry a value are the ones a human approves, plus one tap
-- worth a single point. If a kind ever appears here that is awarded at the
-- moment of submission, this is the check that should have stopped it.
select assert(point_value('spot_approved') > 0, 'an approved spot is worth something');
select assert(point_value('photo_approved') > 0, 'an approved photo is worth something');
select assert(point_value('report_accurate') > 0, 'a report that was right is worth something');
select assert(point_value('spot_submitted') = 0,
  'submitting is NOT paid for — paying for it funds a queue of junk');
select assert(point_value('photo_uploaded') = 0, 'uploading is not paid for; an approved photo is');
select assert(point_value('report_filed') = 0,
  'filing a report is not paid for; being right about it is');
select assert(point_value('signup') = 0, 'signing up is not paid for');
select assert(point_value(null) = 0, 'an unknown kind is worth nothing');
select assert(point_value('anything else') = 0, 'an invented kind is worth nothing');

-- A reviewed contribution has to be worth far more than a tap, or tapping is
-- the rational way to earn and the queue gets nothing.
select assert(point_value('spot_approved') >= 20 * point_value('signal'),
  'an accepted spot is worth at least twenty taps, so contributing beats tapping');
select assert(point_daily_cap('signal') is not null,
  'the tap is capped — 744 spots would otherwise be 744 points');
select assert(point_daily_cap('spot_approved') is null,
  'an approved spot is uncapped — a good contributor is never refused their thanks');

--------------------------------------------------------------------------------
\echo ''
\echo '3. The same act is paid once'
--------------------------------------------------------------------------------
select assert(award_points('dddd0000-0000-0000-0000-000000000001', 'spot_approved', 'sub-1') = 25,
  'an approved spot is paid');
select assert(award_points('dddd0000-0000-0000-0000-000000000001', 'spot_approved', 'sub-1') = 0,
  'approving it again pays nothing — an admin double-tap must not double-pay');
select assert(award_points('dddd0000-0000-0000-0000-000000000001', 'spot_approved', ' sub-1 ') = 0,
  'and neither does the same ref with whitespace round it');
select assert(count(*) = 1, 'one row for one act')
  from contribution_points
 where user_id = 'dddd0000-0000-0000-0000-000000000001' and kind = 'spot_approved';

select assert(award_points('dddd0000-0000-0000-0000-000000000001', 'spot_approved', 'sub-2') = 25,
  'a different spot is a different payment');
select assert(award_points('dddd0000-0000-0000-0000-000000000002', 'spot_approved', 'sub-1') = 25,
  'and another driver''s spot is theirs, not a duplicate of the first');

select assert(award_points(null, 'spot_approved', 'sub-9') = 0, 'an award to nobody pays nothing');
select assert(award_points('dddd0000-0000-0000-0000-000000000001', 'spot_approved', null) = 0,
  'an award for nothing pays nothing');
select assert(award_points('dddd0000-0000-0000-0000-000000000001', 'spot_approved', '   ') = 0,
  'an award with a blank reference pays nothing');
select assert(award_points('dddd0000-0000-0000-0000-000000000001', 'spot_submitted', 'sub-3') = 0,
  'an unpriced kind pays nothing');

-- An account deleted since it contributed. The foreign key would raise and take
-- the approval down with it, which is why this returns 0 instead.
select assert(award_points('eeee0000-0000-0000-0000-00000000dead', 'spot_approved', 'sub-4') = 0,
  'an award to a deleted account is declined, not an error that fails the approval');
select assert(count(*) = 0, 'and writes nothing')
  from contribution_points where user_id = 'eeee0000-0000-0000-0000-00000000dead';

--------------------------------------------------------------------------------
\echo ''
\echo '4. The tap is capped'
--------------------------------------------------------------------------------
-- 744 spots on the map. Without a cap, confirming all of them is 744 points,
-- which is seven months of Premium for seven minutes of tapping.
do $$
declare i int; got int; total int := 0;
begin
  for i in 1..12 loop
    got := public.award_points('dddd0000-0000-0000-0000-000000000002', 'signal', 'spot-' || i);
    total := total + got;
  end loop;
  perform public.assert(total = public.point_daily_cap('signal'),
    'a day of tapping pays the cap and no more (got ' || total || ')');
end $$;

-- Yesterday's taps do not hold today's back.
update contribution_points set created_at = now() - interval '2 days'
 where user_id = 'dddd0000-0000-0000-0000-000000000002' and kind = 'signal';
select assert(award_points('dddd0000-0000-0000-0000-000000000002', 'signal', 'spot-99') = 1,
  'the cap is a day, not a lifetime');

-- And the cap is per driver, not global: one busy contributor must not stop
-- everybody else being thanked. Driver 2 is put back ON the cap first — the
-- earlier check backdated their taps, so without this the day's total is under
-- the cap for everybody and a global cap would pass here unnoticed.
do $$
declare i int;
begin
  for i in 1..10 loop
    perform public.award_points('dddd0000-0000-0000-0000-000000000002', 'signal', 'fresh-' || i);
  end loop;
end $$;
select assert(coalesce(sum(points), 0) >= point_daily_cap('signal'),
  'driver 2 is sitting on the cap for today')
  from contribution_points
 where user_id = 'dddd0000-0000-0000-0000-000000000002' and kind = 'signal'
   and created_at > now() - interval '24 hours';
select assert(award_points('dddd0000-0000-0000-0000-000000000001', 'signal', 'spot-1') = 1,
  'the cap is per driver — one busy contributor does not silence everybody else');

--------------------------------------------------------------------------------
\echo ''
\echo '5. What the driver is shown'
--------------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '', false);
select assert((my_points() ->> 'signed_in') = 'false', 'a guest is told they are signed out');
select assert((my_points() ->> 'balance')::int = 0, 'and shown a zero rather than a null');
select assert((my_points() ->> 'can_redeem') = 'false', 'a guest cannot redeem');
select assert((my_points() ->> 'cost')::int = point_reward_cost(),
  'the cost shown is the cost charged');
select assert((my_points() ->> 'days')::int = point_reward_days(),
  'the days shown are the days granted');

select set_config('request.jwt.claim.sub', 'dddd0000-0000-0000-0000-000000000001', false);
select assert((my_points() ->> 'signed_in') = 'true', 'a signed-in driver is recognised');
select assert((my_points() ->> 'earned')::int = 51,
  'their earnings are their own: 25 + 25 + 1');
select assert((my_points() ->> 'balance')::int = 51, 'with nothing spent yet');
select assert((my_points() ->> 'can_redeem') = 'false',
  'and 51 of 100 does not offer a reward it cannot give');

-- One driver must never see another's balance.
select assert((my_points() ->> 'earned')::int
                <> (select coalesce(sum(points), 0) from contribution_points),
  'my_points() sums one driver, not the whole table');

-- The price and the reward, read from the branch a real driver gets. These were
-- asserted only against the signed-out branch at first, so a signed-in driver
-- could have been quoted any number at all.
select assert((my_points() ->> 'cost')::int = point_reward_cost(),
  'a signed-in driver is quoted the price that will actually be charged');
select assert((my_points() ->> 'days')::int = point_reward_days(),
  'and the number of days that will actually be granted');

--------------------------------------------------------------------------------
\echo ''
\echo '6. Spending it, once'
--------------------------------------------------------------------------------
select assert((redeem_points() ->> 'ok') = 'false', 'a driver short of the cost is refused');
select assert((redeem_points() ->> 'reason') = 'not_enough', 'and told which it was');
select assert(count(*) = 0, 'a refusal writes no premium row')
  from promo_redemptions where user_id = 'dddd0000-0000-0000-0000-000000000001';

-- Earn the rest honestly.
select award_points('dddd0000-0000-0000-0000-000000000001', 'spot_approved', 'sub-' || g)
  from generate_series(10, 13) g;
select assert((my_points() ->> 'balance')::int >= point_reward_cost(), 'now they can afford it');
select assert((my_points() ->> 'can_redeem') = 'true', 'and are told so');

select assert((redeem_points() ->> 'ok') = 'true', 'the reward is granted');
select assert(count(*) = 1, 'as a promo_redemptions row, which is what has_premium() reads')
  from promo_redemptions where user_id = 'dddd0000-0000-0000-0000-000000000001' and code = 'POINTS';
-- Against what my_points() QUOTED, not against a literal: the number on the
-- button and the number in the grant have to be the same number.
select assert(
  expires_at between now() + make_interval(days => (my_points() ->> 'days')::int) - interval '1 hour'
               and now() + make_interval(days => (my_points() ->> 'days')::int) + interval '1 hour',
  'the days granted are the days the driver was shown')
  from promo_redemptions where user_id = 'dddd0000-0000-0000-0000-000000000001' and code = 'POINTS';

-- The spend is a ledger row, so the balance is one sum that cannot disagree
-- with its own history.
select assert((my_points() ->> 'spent')::int = (my_points() ->> 'cost')::int,
  'the spend taken is exactly the cost quoted');
select assert((my_points() ->> 'balance')::int
                = (my_points() ->> 'earned')::int - (my_points() ->> 'spent')::int,
  'and the balance is earned minus spent');
select assert((select coalesce(sum(points), 0) from contribution_points
                where user_id = 'dddd0000-0000-0000-0000-000000000001')
              = (my_points() ->> 'balance')::int,
  'the ledger and the reported balance agree');

-- Premium really is live now, which is the entire point of the currency.
select set_config('request.jwt.claims',
  '{"sub":"dddd0000-0000-0000-0000-000000000001","email":"giver@test.local"}', false);
select assert(has_premium(), 'the points actually bought Premium');

--------------------------------------------------------------------------------
\echo ''
\echo '7. Redeeming twice adds days; it does not overwrite them'
--------------------------------------------------------------------------------
-- promo_redemptions is UNIQUE on (user_id, code), so a second redemption under
-- the same code is a constraint violation unless it extends — and extending is
-- the right behaviour in any case.
select set_config('request.jwt.claim.sub', 'dddd0000-0000-0000-0000-000000000001', false);
select award_points('dddd0000-0000-0000-0000-000000000001', 'spot_approved', 'sub-2' || g)
  from generate_series(1, 4) g;
select assert((redeem_points() ->> 'ok') = 'true', 'a second redemption is allowed');
select assert(count(*) = 1, 'still one premium row')
  from promo_redemptions where user_id = 'dddd0000-0000-0000-0000-000000000001' and code = 'POINTS';
select assert(expires_at > now() + interval '59 days',
  'the days are added on the end rather than the second thirty replacing the first')
  from promo_redemptions where user_id = 'dddd0000-0000-0000-0000-000000000001' and code = 'POINTS';
select assert(count(*) = 2, 'and there are two spends in the ledger')
  from contribution_points
 where user_id = 'dddd0000-0000-0000-0000-000000000001' and kind = 'redeemed';

-- A driver already holding Premium bought with money keeps every day of it.
insert into auth.users (id, email) values
  ('dddd0000-0000-0000-0000-000000000003', 'subscriber@test.local') on conflict do nothing;
insert into promo_redemptions (user_id, user_email, code, expires_at)
values ('dddd0000-0000-0000-0000-000000000003', 'subscriber@test.local', 'POINTS',
        now() + interval '100 days')
  on conflict (user_id, code) do update set expires_at = excluded.expires_at;
select award_points('dddd0000-0000-0000-0000-000000000003', 'spot_approved', 'sub-3' || g)
  from generate_series(1, 4) g;
select set_config('request.jwt.claim.sub', 'dddd0000-0000-0000-0000-000000000003', false);
select assert((redeem_points() ->> 'ok') = 'true', 'a subscriber can redeem too');
select assert(expires_at > now() + interval '129 days',
  'their existing days are extended, not swallowed')
  from promo_redemptions where user_id = 'dddd0000-0000-0000-0000-000000000003' and code = 'POINTS';

--------------------------------------------------------------------------------
\echo ''
\echo '8. A signed-out caller cannot spend anybody''s points'
--------------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '', false);
select set_config('request.jwt.claims', '{}', false);
select assert((redeem_points() ->> 'ok') = 'false', 'a signed-out caller is refused');
select assert((redeem_points() ->> 'reason') = 'signed_out', 'and told why');
-- redeem_points() takes no arguments at all, so there is nothing to point at
-- somebody else's account.
select assert(count(*) = 0, 'redeem_points() takes no arguments — there is no account to name')
  from information_schema.parameters
 where specific_name in (select specific_name from information_schema.routines
                          where routine_name = 'redeem_points' and specific_schema = 'public');
select assert(not has_function_privilege('anon', 'public.redeem_points()', 'execute'),
  'and anon cannot call it at all');

\echo ''
