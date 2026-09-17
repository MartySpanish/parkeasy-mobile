-- Referrals, and every way one turns into free Premium for nothing.
--
-- The scheme has exactly one expensive failure mode: paying for an account
-- rather than for a contributor. So the sections below are the routes to that —
--
--   * a bounty that lands on signup,
--   * referring yourself,
--   * one account walked round a circle of friends,
--   * an existing contributor typing a friend's code,
--   * the same referral paid twice,
--   * a driver qualifying their own referral,
--
-- and one that is cheap but corrosive: a code that reads ambiguously, so a
-- referral silently goes to nobody and the driver who mistyped it never knows.
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
  ('aaaa1111-0000-0000-0000-000000000001', 'alice@test.local'),
  ('aaaa1111-0000-0000-0000-000000000002', 'bob@test.local'),
  ('aaaa1111-0000-0000-0000-000000000003', 'carol@test.local'),
  ('aaaa1111-0000-0000-0000-000000000004', 'dave@test.local')
  on conflict do nothing;

-- Convenience: act as somebody.
create or replace function be(p_uid uuid) returns void language sql as $$
  select set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), false);
  select set_config('request.jwt.claims',
    case when p_uid is null then '{}'
         else json_build_object('sub', p_uid, 'email', 'x@test.local')::text end, false);
$$;

--------------------------------------------------------------------------------
\echo ''
\echo '1. Nothing here is reachable from a browser except your own side of it'
--------------------------------------------------------------------------------
select assert((select relrowsecurity from pg_class
                where oid = 'public.referrals'::regclass),
  'row level security is on for referrals');
select assert((select relrowsecurity from pg_class
                where oid = 'public.referral_codes'::regclass),
  'and for referral_codes');

-- The full list of codes is the one thing that would let somebody attribute
-- their own signups to a stranger at random.
select assert(count(*) = 0, 'the code table is not readable by anybody')
  from information_schema.role_table_grants
 where table_name = 'referral_codes' and grantee in ('anon', 'authenticated');
select assert(count(*) = 0, 'and not writable either')
  from pg_policies where tablename = 'referral_codes';

select assert(count(*) = 0, 'referrals cannot be written from the app')
  from information_schema.role_table_grants
 where table_name = 'referrals' and grantee in ('anon', 'authenticated')
   and privilege_type in ('INSERT', 'UPDATE', 'DELETE');
select assert(count(*) = 1, 'one policy on referrals: reading the ones you made')
  from pg_policies where tablename = 'referrals';

-- A driver who could qualify a referral could qualify their own, which is the
-- whole thing this file exists to prevent.
select assert(not has_function_privilege('authenticated', 'public.qualify_referral(uuid,text)', 'execute'),
  'a signed-in driver cannot qualify a referral');
select assert(not has_function_privilege('anon', 'public.qualify_referral(uuid,text)', 'execute'),
  'nor can anon');
select assert(has_function_privilege('service_role', 'public.qualify_referral(uuid,text)', 'execute'),
  'only the admin API can, on an approval');

select assert(
  (select prosecdef from pg_proc where oid = v.fn::regprocedure)
  and (select proconfig::text like '%search_path=public, pg_temp%'
         from pg_proc where oid = v.fn::regprocedure),
  v.fn || ' is SECURITY DEFINER with a pinned search_path')
 from (values ('public.my_referral_code()'),
              ('public.claim_referral(text)'),
              ('public.qualify_referral(uuid,text)'),
              ('public.my_referrals()')) v(fn);

--------------------------------------------------------------------------------
\echo ''
\echo '2. The code can be read out in a car park'
--------------------------------------------------------------------------------
select be('aaaa1111-0000-0000-0000-000000000001');
select assert(my_referral_code() ~ '^[ABCDEFGHJKMNPQRTUVWXYZ2346789]{6}$', 'a code is six characters');

-- 0/O, 1/I/L and 5/S are not all in the alphabet. A mistyped code is a referral
-- that goes silently to nobody, and the driver who mistyped it cannot tell.
select assert(my_referral_code() !~ '[ILOS015]',
  'the code has no characters that are read as each other');

-- Stable forever, because it goes in messages and on paper.
select assert(my_referral_code() = my_referral_code(), 'asking twice gives the same code');
select assert(count(*) = 1, 'and creates one row, not two')
  from referral_codes where user_id = 'aaaa1111-0000-0000-0000-000000000001';

select be('aaaa1111-0000-0000-0000-000000000002');
select assert(my_referral_code() <> (select code from referral_codes
                                      where user_id = 'aaaa1111-0000-0000-0000-000000000001'),
  'two drivers get different codes');

select be(null);
select assert(my_referral_code() is null, 'a signed-out caller gets no code');

--------------------------------------------------------------------------------
\echo ''
\echo '3. Claiming: recorded, and paying nobody yet'
--------------------------------------------------------------------------------
select be('aaaa1111-0000-0000-0000-000000000003');
select assert((claim_referral((select code from referral_codes
                               where user_id = 'aaaa1111-0000-0000-0000-000000000001'))
               ->> 'ok') = 'true',
  'a new driver can claim a friend''s code');
select assert(count(*) = 1, 'the referral is recorded')
  from referrals where invitee_id = 'aaaa1111-0000-0000-0000-000000000003';

-- THE ONE THAT COSTS MONEY. Pay on signup and you are buying signups, which
-- cost nothing to manufacture.
select assert((select count(*) from referrals
                where invitee_id = 'aaaa1111-0000-0000-0000-000000000003'
                  and qualified_at is null) = 1,
  'and is unpaid — a signup is not a contribution');
select assert(count(*) = 0, 'no points have moved')
  from contribution_points
 where user_id in ('aaaa1111-0000-0000-0000-000000000001',
                   'aaaa1111-0000-0000-0000-000000000003');

-- Lower case and stray spaces are what a person actually types.
select be('aaaa1111-0000-0000-0000-000000000004');
select assert((claim_referral('  ' || lower((select code from referral_codes
                where user_id = 'aaaa1111-0000-0000-0000-000000000002')) || ' ')
               ->> 'ok') = 'true',
  'a code typed in lower case with spaces round it still works');

--------------------------------------------------------------------------------
\echo ''
\echo '4. The claims that are refused, and told why'
--------------------------------------------------------------------------------
select be('aaaa1111-0000-0000-0000-000000000001');
select assert((claim_referral((select code from referral_codes
                where user_id = 'aaaa1111-0000-0000-0000-000000000001')) ->> 'reason') = 'own_code',
  'referring yourself is refused, and named');
select assert(count(*) = 0, 'and writes nothing')
  from referrals where invitee_id = 'aaaa1111-0000-0000-0000-000000000001';

-- One row per invited driver, EVER. Not per (referrer, invitee): otherwise one
-- account is walked round a circle of friends collecting a bounty each time.
select be('aaaa1111-0000-0000-0000-000000000003');
select assert((claim_referral((select code from referral_codes
                where user_id = 'aaaa1111-0000-0000-0000-000000000002')) ->> 'reason')
              = 'already_referred',
  'a second code from a different friend is refused');
select assert(count(*) = 1, 'so an account cannot be walked round a circle of friends')
  from referrals where invitee_id = 'aaaa1111-0000-0000-0000-000000000003';
select assert((select referrer_id from referrals
                where invitee_id = 'aaaa1111-0000-0000-0000-000000000003')
              = 'aaaa1111-0000-0000-0000-000000000001',
  'and the first referrer keeps it');

select assert((claim_referral('ZZZZZZ') ->> 'reason') = 'unknown_code',
  'a code nobody owns is refused');
select assert((claim_referral('ABC') ->> 'reason') = 'bad_code', 'a short code is refused');
select assert((claim_referral('ABC0IL') ->> 'reason') = 'bad_code',
  'a code with confusable characters cannot even be a code');
select assert((claim_referral(null) ->> 'reason') = 'bad_code', 'no code at all is refused');
select assert((claim_referral('') ->> 'reason') = 'bad_code', 'an empty code is refused');

select be(null);
select assert((claim_referral('ABCDEF') ->> 'reason') = 'signed_out',
  'a signed-out caller is refused');

-- An account that has already contributed is not somebody's referral; it is an
-- existing driver typing a friend's code. Paying for that is paying for nothing.
select award_points('aaaa1111-0000-0000-0000-000000000002', 'spot_approved', 'sub-existing');
select be('aaaa1111-0000-0000-0000-000000000002');
select assert((claim_referral((select code from referral_codes
                where user_id = 'aaaa1111-0000-0000-0000-000000000001')) ->> 'reason') = 'not_new',
  'an existing contributor cannot be referred after the fact');

--------------------------------------------------------------------------------
\echo ''
\echo '5. Paid when the invited driver turns out to be real'
--------------------------------------------------------------------------------
-- Carol contributes something a human approves. That is the moment.
select award_points('aaaa1111-0000-0000-0000-000000000003', 'spot_approved', 'sub-carol-1');
select assert((qualify_referral('aaaa1111-0000-0000-0000-000000000003', 'spot sub-carol-1')
               ->> 'ok') = 'true',
  'the referral pays on an approved contribution');

select assert((select qualified_at from referrals
                where invitee_id = 'aaaa1111-0000-0000-0000-000000000003') is not null,
  'the referral is marked paid');
select assert((select qualified_by from referrals
                where invitee_id = 'aaaa1111-0000-0000-0000-000000000003') = 'spot sub-carol-1',
  'with what earned it, for a year from now');

-- SCALAR SUBQUERIES, not `from contribution_points where ...`. A `select
-- assert(...) from t where ...` over an empty result runs the assert ZERO
-- times and reports nothing — so deleting the award entirely would pass. It
-- did, until this was written the other way round.
select assert((select points from contribution_points
                where user_id = 'aaaa1111-0000-0000-0000-000000000001'
                  and kind = 'referral_paid') = referral_points('referrer'),
  'the referrer is paid the referrer rate');
select assert((select points from contribution_points
                where user_id = 'aaaa1111-0000-0000-0000-000000000003'
                  and kind = 'referral_bonus') = referral_points('invitee'),
  'the invited driver gets the welcome');

-- The referrer did the persuading, which is the hard part; the invited driver
-- was going to be paid for the contribution anyway.
select assert(referral_points('referrer') > referral_points('invitee'),
  'the referrer is paid more than the person they brought');
select assert(referral_points('nonsense') = 0, 'an invented side is worth nothing');

-- Everything goes through award_points, so the ledger is the single account of
-- every point in the system.
select assert(point_value('referral_paid') = referral_points('referrer'),
  'the referral price is the price point_value pays');
select assert(point_value('referral_bonus') = referral_points('invitee'),
  'and so is the welcome');
-- The four original kinds still price the same: extending point_value must not
-- quietly re-tariff the rest.
select assert(point_value('spot_approved') = 25, 'an approved spot is still 25');
select assert(point_value('photo_approved') = 10, 'an approved photo is still 10');
select assert(point_value('report_accurate') = 15, 'a correct report is still 15');
select assert(point_value('signal') = 1, 'a tap is still 1');
select assert(point_value('referral_signup') = 0, 'signing up is still worth nothing');

--------------------------------------------------------------------------------
\echo ''
\echo '6. Paid once'
--------------------------------------------------------------------------------
select assert((qualify_referral('aaaa1111-0000-0000-0000-000000000003', 'again') ->> 'reason')
              = 'nothing_pending',
  'a second approval from the same driver pays nothing more');
select assert(count(*) = 1, 'one referral payment, not two')
  from contribution_points
 where user_id = 'aaaa1111-0000-0000-0000-000000000001' and kind = 'referral_paid';
select assert((select qualified_by from referrals
                where invitee_id = 'aaaa1111-0000-0000-0000-000000000003') = 'spot sub-carol-1',
  'and the reason is not overwritten');

-- Called on every approval, and most approvals are not referrals. That is not
-- an error and must not read like one.
select assert((qualify_referral('aaaa1111-0000-0000-0000-000000000001', 'x') ->> 'reason')
              = 'nothing_pending',
  'a driver nobody referred is not an error');
select assert((qualify_referral(null, 'x') ->> 'reason') = 'no_invitee', 'nor is no driver at all');

--------------------------------------------------------------------------------
\echo ''
\echo '7. What the referrer is shown'
--------------------------------------------------------------------------------
select be('aaaa1111-0000-0000-0000-000000000001');
select assert((my_referrals() ->> 'joined')::int = 1, 'the count of drivers who joined');
select assert((my_referrals() ->> 'qualified')::int = 1, 'and how many of them counted');
select assert((my_referrals() ->> 'code') = (select code from referral_codes
                where user_id = 'aaaa1111-0000-0000-0000-000000000001'),
  'with their own code');
select assert((my_referrals() ->> 'points_each')::int = referral_points('referrer'),
  'and the rate they are actually paid');

-- BOTH NUMBERS, always. "4 joined, 2 counted" is the honest story; showing only
-- the first implies points that are not coming.
select be('aaaa1111-0000-0000-0000-000000000002');
select assert((my_referrals() ->> 'joined')::int = 1, 'dave joined on bob''s code');
select assert((my_referrals() ->> 'qualified')::int = 0,
  'and has not contributed yet, which is said rather than hidden');

-- One referrer's numbers are not another's.
select assert((my_referrals() ->> 'code') <> (select code from referral_codes
                where user_id = 'aaaa1111-0000-0000-0000-000000000001'),
  'my_referrals() reads the caller, not the first row in the table');

select be(null);
select assert((my_referrals() ->> 'signed_in') = 'false', 'a guest is told they are signed out');
select assert((my_referrals() ->> 'joined')::int = 0, 'and shown zeros rather than nulls');
select assert((my_referrals() ->> 'points_each')::int = referral_points('referrer'),
  'and still told what a referral is worth, which is the point of showing them');

--------------------------------------------------------------------------------
\echo ''
\echo '8. A driver reads their own referrals and nobody else''s'
--------------------------------------------------------------------------------
-- AS THE ROLE, not as the owner. Everything above runs as the table owner,
-- which bypasses RLS completely — so the read policy could have been
-- `using (true)` and every check would still have passed. It was.
grant usage on schema public to authenticated;
set role authenticated;
select be('aaaa1111-0000-0000-0000-000000000001');
select assert((select count(*) from public.referrals) = 1,
  'alice sees the one referral she made');
select assert((select count(*) from public.referrals
                where referrer_id <> 'aaaa1111-0000-0000-0000-000000000001') = 0,
  'and not the ones pointing at anybody else');
select be('aaaa1111-0000-0000-0000-000000000004');
select assert((select count(*) from public.referrals) = 0,
  'dave was referred by bob and cannot see that row — whose code somebody used '
  'is between them and us');

-- And the code table is not readable at all, whoever asks.
do $$
begin
  begin
    perform 1 from public.referral_codes limit 1;
    raise exception 'FAIL  a driver can read the table of every referral code';
  exception when insufficient_privilege then
    perform public.assert(true, 'the code table is unreadable even to a signed-in driver');
  end;
end $$;
reset role;

--------------------------------------------------------------------------------
\echo ''
\echo '9. The database refuses a self-referral even if a function forgets'
--------------------------------------------------------------------------------
-- The rule is a table constraint, not only a check inside claim_referral: a
-- rule that exists only in a function is a rule the next function forgets.
do $$
begin
  begin
    insert into public.referrals (referrer_id, invitee_id, code)
    values ('aaaa1111-0000-0000-0000-000000000001',
            'aaaa1111-0000-0000-0000-000000000001', 'ABCDEF');
    raise exception 'FAIL  a self-referral was accepted by the table';
  exception when check_violation then
    perform public.assert(true, 'the table itself refuses a self-referral');
  end;

  begin
    insert into public.referrals (referrer_id, invitee_id, code)
    values ('aaaa1111-0000-0000-0000-000000000004',
            'aaaa1111-0000-0000-0000-000000000003', 'ABCDEF');
    raise exception 'FAIL  a second referral of one driver was accepted';
  exception when unique_violation then
    perform public.assert(true, 'and refuses a second referral of the same driver');
  end;

  begin
    insert into public.referral_codes (user_id, code)
    values ('aaaa1111-0000-0000-0000-000000000003', 'ABC0IL');
    raise exception 'FAIL  a confusable code was accepted';
  exception when check_violation then
    perform public.assert(true, 'and refuses a code with confusable characters in it');
  end;

  -- "Two drivers get different codes" above is true by a 594-million-to-one
  -- coincidence. THIS is what actually guarantees it: without the unique
  -- constraint one of the two drivers' referrals would go to the other.
  begin
    insert into public.referral_codes (user_id, code)
    values ('aaaa1111-0000-0000-0000-000000000003',
            (select code from public.referral_codes
              where user_id = 'aaaa1111-0000-0000-0000-000000000001'));
    raise exception 'FAIL  two drivers were given the same code';
  exception when unique_violation then
    perform public.assert(true, 'and refuses to hand two drivers the same code');
  end;
end $$;

\echo ''
