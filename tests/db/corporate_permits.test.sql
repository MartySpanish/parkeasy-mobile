-- Tests for the corporate pooled-permit rules.
--
--   tests/db/run.sh supabase/migrations/20260820_corporate_permits.sql \
--                   tests/db/corporate_permits.test.sql
--
-- Every check raises on failure, so a green run means every line passed and a
-- red run names the rule that broke. Concurrency is tested separately, in
-- tests/db/concurrency.sh — it needs real simultaneous sessions, which a single
-- psql script cannot produce.
\set ON_ERROR_STOP on
\timing off
set client_min_messages = notice;

create or replace function assert(p_cond boolean, p_what text)
returns void language plpgsql as $$
begin
  if p_cond then raise notice '  PASS  %', p_what;
  else raise exception 'FAIL  %', p_what;
  end if;
end $$;

--------------------------------------------------------------------------------
-- Fixtures
--------------------------------------------------------------------------------
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111','ann@acme.test'),
  ('22222222-2222-2222-2222-222222222222','bob@acme.test'),
  ('33333333-3333-3333-3333-333333333333','cara@acme.test'),
  ('44444444-4444-4444-4444-444444444444','dan@rival.test');

-- status='draft': these only need to EXIST as the block's foreign key. The
-- real table refuses status='active' without eleven other fields, and this
-- suite is not testing the publish rules.
insert into public.rental_listings (id, title, address, status) values
  ('aaaaaaaa-0000-0000-0000-000000000001','Lanyon Place Car Park','Lanyon Place, Belfast','draft'),
  ('aaaaaaaa-0000-0000-0000-000000000002','Oxford Street Car Park','Oxford Street, Belfast','draft');

insert into public.corporate_accounts (id, company_name, billing_contact_email) values
  ('c0000000-0000-0000-0000-000000000001','Acme Ltd','billing@acme.test'),
  ('c0000000-0000-0000-0000-000000000002','Rival Ltd','billing@rival.test');

insert into public.corporate_permit_blocks
  (id, corporate_account_id, listing_id, permit_count, monthly_price_pence, operator_share_pct, start_date)
values
  ('b0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000001', 1, 12000, 70.00, current_date - 30),
  ('b0000000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000001',
   'aaaaaaaa-0000-0000-0000-000000000002', 3, 30000, 70.00, current_date - 30),
  ('b0000000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-000000000002',
   'aaaaaaaa-0000-0000-0000-000000000001', 5, 50000, 70.00, current_date - 30);

insert into public.corporate_members
  (id, corporate_account_id, user_id, email, full_name, role, status)
values
  ('11110000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001',
   '11111111-1111-1111-1111-111111111111','ann@acme.test','Ann','admin','active'),
  ('11110000-0000-0000-0000-000000000002','c0000000-0000-0000-0000-000000000001',
   '22222222-2222-2222-2222-222222222222','bob@acme.test','Bob','member','active'),
  ('11110000-0000-0000-0000-000000000003','c0000000-0000-0000-0000-000000000001',
   '33333333-3333-3333-3333-333333333333','cara@acme.test','Cara','member','active'),
  ('11110000-0000-0000-0000-000000000004','c0000000-0000-0000-0000-000000000002',
   '44444444-4444-4444-4444-444444444444','dan@rival.test','Dan','admin','active'),
  -- A fourth Acme member with no login, used to push a block past its quota.
  -- Created HERE and not inside the test that needs it: that test is expected
  -- to raise, and a raise inside a DO block rolls back everything the block
  -- did, including the fixture it just inserted.
  ('11110000-0000-0000-0000-000000000005','c0000000-0000-0000-0000-000000000001',
   null,'extra@acme.test','Extra','member','active');

--------------------------------------------------------------------------------
\echo ''
\echo '1. Vehicle registration normalisation'
--------------------------------------------------------------------------------
select assert(public.normalise_vrn('bt21 abc')  = 'BT21ABC', 'lowercase and spaces normalise');
select assert(public.normalise_vrn(' BT21-ABC ') = 'BT21ABC', 'hyphens and padding normalise');
select assert(public.normalise_vrn('   ') is null,           'blank normalises to null, not an empty plate');

insert into public.member_vehicles (corporate_member_id, vrn, is_primary)
values ('11110000-0000-0000-0000-000000000002', 'bt21 abc', true);
select assert(
  (select vrn from public.member_vehicles
    where corporate_member_id = '11110000-0000-0000-0000-000000000002') = 'BT21ABC',
  'stored normalised whatever was typed');

do $$ begin
  insert into public.member_vehicles (corporate_member_id, vrn, is_primary)
  values ('11110000-0000-0000-0000-000000000002', 'XYZ 999', true);
  raise exception 'FAIL  a member got two primary vehicles';
exception when unique_violation then
  raise notice '  PASS  only one primary vehicle per member';
end $$;

--------------------------------------------------------------------------------
\echo ''
\echo '2. The quota'
--------------------------------------------------------------------------------
do $$
declare v public.permit_claims;
begin
  v := public.claim_permit('b0000000-0000-0000-0000-000000000002',
                           '11110000-0000-0000-0000-000000000001', current_date + 7, 'BT21 AAA');
  perform assert(v.status = 'claimed', 'first claim on a 3-permit block succeeds');
  perform assert(v.vrn = 'BT21AAA',    'the claim snapshots a normalised plate');

  perform public.claim_permit('b0000000-0000-0000-0000-000000000002',
                              '11110000-0000-0000-0000-000000000002', current_date + 7, 'BT21BBB');
  perform public.claim_permit('b0000000-0000-0000-0000-000000000002',
                              '11110000-0000-0000-0000-000000000003', current_date + 7, 'BT21CCC');
  perform assert(
    (select count(*) from public.permit_claims
      where corporate_permit_block_id = 'b0000000-0000-0000-0000-000000000002'
        and claim_date = current_date + 7 and status = 'claimed') = 3,
    'three permits claimed on a 3-permit block');
end $$;

-- The fourth. Only three members exist in Acme, so re-invite is not the issue:
-- this proves the count gate, using a member who already holds another date.
do $$ begin
  perform public.claim_permit('b0000000-0000-0000-0000-000000000002',
                              '11110000-0000-0000-0000-000000000001', current_date + 8, 'BT21AAA');
  perform assert(true, 'a different date is unaffected by a full one');
end $$;

do $$ begin
  perform public.claim_permit('b0000000-0000-0000-0000-000000000002',
                              '11110000-0000-0000-0000-000000000005', current_date + 7, 'BT21EEE');
  raise exception 'FAIL  a 4th permit was issued on a 3-permit block';
exception when sqlstate 'PE007' then
  raise notice '  PASS  the 4th claim is refused: fully booked for that date';
end $$;

--------------------------------------------------------------------------------
\echo ''
\echo '3. Cancelling frees the slot immediately'
--------------------------------------------------------------------------------
do $$
declare v_claim uuid;
begin
  select id into v_claim from public.permit_claims
   where corporate_permit_block_id = 'b0000000-0000-0000-0000-000000000002'
     and claim_date = current_date + 7 and status = 'claimed' limit 1;
  perform public.cancel_permit_claim(v_claim);
  perform assert(
    (select count(*) from public.permit_claims
      where corporate_permit_block_id = 'b0000000-0000-0000-0000-000000000002'
        and claim_date = current_date + 7 and status = 'claimed') = 2,
    'a cancellation drops the claimed count');

  perform public.claim_permit('b0000000-0000-0000-0000-000000000002',
                              '11110000-0000-0000-0000-000000000005', current_date + 7, 'BT21EEE');
  perform assert(true, 'the freed slot is claimable at once — no cutoff');
end $$;

-- Cancel and re-claim the SAME date. A plain UNIQUE (block, member, date) would
-- block this forever, because the cancelled row is never deleted.
do $$
declare v_claim uuid;
begin
  select id into v_claim from public.permit_claims
   where corporate_member_id = '11110000-0000-0000-0000-000000000001'
     and claim_date = current_date + 8 and status = 'claimed';
  perform public.cancel_permit_claim(v_claim);
  perform public.claim_permit('b0000000-0000-0000-0000-000000000002',
                              '11110000-0000-0000-0000-000000000001', current_date + 8, 'BT21AAA');
  perform assert(
    (select count(*) from public.permit_claims
      where corporate_member_id = '11110000-0000-0000-0000-000000000001'
        and claim_date = current_date + 8) = 2,
    'cancel then re-claim the same date works, and both rows survive');
end $$;

do $$ begin
  perform public.claim_permit('b0000000-0000-0000-0000-000000000002',
                              '11110000-0000-0000-0000-000000000001', current_date + 8, 'BT21AAA');
  raise exception 'FAIL  one member holds two live claims for one date';
exception when sqlstate 'PE008' then
  raise notice '  PASS  a member cannot hold two live claims for the same date';
end $$;

--------------------------------------------------------------------------------
\echo ''
\echo '4. Cross-company isolation at the function level'
--------------------------------------------------------------------------------
do $$ begin
  -- Dan works for Rival. Even handed Acme's block id directly, he is refused.
  perform public.claim_permit('b0000000-0000-0000-0000-000000000002',
                              '11110000-0000-0000-0000-000000000004', current_date + 9, 'BT21DDD');
  raise exception 'FAIL  a member claimed against another company''s block';
exception when sqlstate 'PE005' then
  raise notice '  PASS  a member cannot claim against another company''s block';
end $$;

--------------------------------------------------------------------------------
\echo ''
\echo '5. Dates and status'
--------------------------------------------------------------------------------
do $$ begin
  perform public.claim_permit('b0000000-0000-0000-0000-000000000001',
                              '11110000-0000-0000-0000-000000000001', current_date - 60, 'BT21AAA');
  raise exception 'FAIL  a date before the block started was accepted';
exception when sqlstate 'PE003' then
  raise notice '  PASS  a date outside the block window is refused';
end $$;

do $$ begin
  update public.corporate_permit_blocks set status = 'paused'
   where id = 'b0000000-0000-0000-0000-000000000001';
  perform public.claim_permit('b0000000-0000-0000-0000-000000000001',
                              '11110000-0000-0000-0000-000000000001', current_date + 3, 'BT21AAA');
  raise exception 'FAIL  a paused block still issued a permit';
exception when sqlstate 'PE002' then
  raise notice '  PASS  a paused block issues nothing';
  update public.corporate_permit_blocks set status = 'active'
   where id = 'b0000000-0000-0000-0000-000000000001';
end $$;

--------------------------------------------------------------------------------
\echo ''
\echo '6. permit_count cannot be cut below claims already made'
--------------------------------------------------------------------------------
do $$ begin
  -- Block 2 has 3 live claims on current_date + 7.
  update public.corporate_permit_blocks set permit_count = 2
   where id = 'b0000000-0000-0000-0000-000000000002';
  raise exception 'FAIL  the quota was cut below existing future claims';
exception when sqlstate 'PE010' then
  raise notice '  PASS  reducing below a future date''s claims is refused';
end $$;

do $$ begin
  update public.corporate_permit_blocks set permit_count = 4
   where id = 'b0000000-0000-0000-0000-000000000002';
  perform assert(true, 'increasing the quota is always allowed');
  update public.corporate_permit_blocks set permit_count = 3
   where id = 'b0000000-0000-0000-0000-000000000002';
  perform assert(true, 'reducing back to the peak is allowed');
end $$;

--------------------------------------------------------------------------------
\echo ''
\echo '7. Removing a member hands their future days back'
--------------------------------------------------------------------------------
do $$
declare v_before integer; v_after integer;
begin
  select count(*) into v_before from public.permit_claims
   where corporate_member_id = '11110000-0000-0000-0000-000000000003'
     and status = 'claimed' and claim_date >= current_date;
  perform assert(v_before > 0, 'Cara holds at least one future claim to start with');

  update public.corporate_members set status = 'removed'
   where id = '11110000-0000-0000-0000-000000000003';

  select count(*) into v_after from public.permit_claims
   where corporate_member_id = '11110000-0000-0000-0000-000000000003'
     and status = 'claimed' and claim_date >= current_date;
  perform assert(v_after = 0, 'removing a member cancels their future claims');
  perform assert(
    (select removed_at is not null from public.corporate_members
      where id = '11110000-0000-0000-0000-000000000003'),
    'removal is stamped, not guessed at');
end $$;

--------------------------------------------------------------------------------
\echo ''
\echo '8. Billing data is never hard-deleted'
--------------------------------------------------------------------------------
do $$ begin
  delete from public.permit_claims where claim_date = current_date + 7;
  raise exception 'FAIL  claims were hard-deleted';
exception when sqlstate 'PE011' then
  raise notice '  PASS  deleting a claim is blocked at the database';
end $$;

do $$ begin
  delete from public.corporate_members where id = '11110000-0000-0000-0000-000000000002';
  raise exception 'FAIL  a member was hard-deleted';
exception when sqlstate 'PE011' then
  raise notice '  PASS  deleting a member is blocked at the database';
end $$;

--------------------------------------------------------------------------------
\echo ''
\echo '9. Row Level Security — company A never sees company B'
--------------------------------------------------------------------------------
-- The claim/cancel functions are SECURITY DEFINER, so a signed-in user must not
-- be able to call them with somebody else''s member id.
do $$
declare v_ok boolean;
begin
  select has_function_privilege('authenticated',
    'public.claim_permit(uuid,uuid,date,text)', 'execute') into v_ok;
  perform assert(not v_ok, 'authenticated cannot execute claim_permit directly');
  select has_function_privilege('anon',
    'public.cancel_permit_claim(uuid)', 'execute') into v_ok;
  perform assert(not v_ok, 'anon cannot execute cancel_permit_claim directly');
end $$;

-- Ann, an Acme admin.
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111', false);
select assert((select count(*) from public.corporate_accounts) = 1,
  'an Acme admin sees exactly one company');
select assert((select company_name from public.corporate_accounts) = 'Acme Ltd',
  'and it is her own');
select assert((select count(*) from public.corporate_permit_blocks) = 2,
  'she sees Acme''s two blocks and neither of Rival''s');
select assert((select count(*) from public.corporate_members) >= 3,
  'an admin sees the staff list');
select assert((select count(*) from public.member_vehicles) = 1,
  'an admin sees her company''s registered plates');

-- Bob, an ordinary Acme member.
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222', false);
select assert((select count(*) from public.corporate_members) = 1,
  'an ordinary member sees only their own membership row');
select assert((select email from public.corporate_members) = 'bob@acme.test',
  'and it is their own');
select assert(
  (select count(*) from public.permit_claims
    where corporate_member_id <> '11110000-0000-0000-0000-000000000002') = 0,
  'an ordinary member sees nobody else''s claims');

-- Dan, at Rival. The whole point of the feature's RLS.
select set_config('request.jwt.claim.sub','44444444-4444-4444-4444-444444444444', false);
select assert((select count(*) from public.corporate_accounts) = 1,
  'Rival''s admin sees exactly one company');
select assert((select company_name from public.corporate_accounts) = 'Rival Ltd',
  'and it is Rival, not Acme');
select assert((select count(*) from public.corporate_permit_blocks) = 1,
  'Rival''s admin sees only Rival''s block');
select assert((select count(*) from public.member_vehicles) = 0,
  'Rival''s admin sees none of Acme''s plates');
select assert((select count(*) from public.permit_claims) = 0,
  'Rival''s admin sees none of Acme''s claims');

-- A signed-out visitor. Not "sees zero rows" — REFUSED. anon has no grant on
-- these tables at all, so the request dies at the permission layer before RLS
-- is consulted, which is one fewer thing that has to be right.
reset role;
select assert(not has_table_privilege('anon','public.corporate_accounts','select'),
  'anon cannot read companies at all');
select assert(not has_table_privilege('anon','public.permit_claims','select'),
  'anon cannot read claims at all');
select assert(not has_table_privilege('anon','public.member_vehicles','select'),
  'anon cannot read plates at all');
select assert(has_table_privilege('authenticated','public.permit_claims','select'),
  'authenticated can read claims, subject to the policies above');
select assert(not has_table_privilege('authenticated','public.permit_claims','insert'),
  'authenticated cannot write claims directly — only the endpoints can');
select assert(not has_table_privilege('authenticated','public.corporate_permit_blocks','update'),
  'authenticated cannot change a quota directly');

--------------------------------------------------------------------------------
\echo ''
\echo '10. operator_settlements adds up'
--------------------------------------------------------------------------------
insert into public.corporate_invoices
  (corporate_account_id, corporate_permit_block_id, stripe_invoice_id,
   amount_due_pence, amount_paid_pence, status, period_start, period_end)
values
  ('c0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000002',
   'in_test_1', 30000, 30000, 'paid', date_trunc('month', now()), date_trunc('month', now()) + interval '1 month'),
  -- An unpaid one, which must not be counted as collected.
  ('c0000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000002',
   'in_test_2', 30000, 0, 'open', date_trunc('month', now()), date_trunc('month', now()) + interval '1 month');

select assert(
  (select gross_collected_pence from public.operator_settlements
    where block_id = 'b0000000-0000-0000-0000-000000000002') = 30000,
  'only paid invoices count as collected');
select assert(
  (select operator_share_due_pence from public.operator_settlements
    where block_id = 'b0000000-0000-0000-0000-000000000002') = 21000,
  '70% of £300.00 is £210.00 due to the operator');
select assert(
  (select parkeasy_net_pence from public.operator_settlements
    where block_id = 'b0000000-0000-0000-0000-000000000002') = 9000,
  'and ParkEasy nets the remaining £90.00');
select assert(
  (select operator_share_due_pence + parkeasy_net_pence from public.operator_settlements
    where block_id = 'b0000000-0000-0000-0000-000000000002') = 30000,
  'the two shares add back to the gross — no penny lost to rounding');

\echo ''
\echo 'ALL CHECKS PASSED'
