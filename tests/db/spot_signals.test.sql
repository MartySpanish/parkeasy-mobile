-- "Confirmed by 0 drivers" — and the two buttons under it that did nothing.
--
-- The rule this suite exists to hold is one sentence: a count shown to drivers
-- must be a count of drivers. Everything here is a way that fails —
--
--   * one person tapping a button repeatedly counting as several people,
--   * a driver changing their mind counting on both sides,
--   * a source voting on every spot in Belfast,
--   * an answer that reaches nobody else,
--   * a flag that can never be cleared,
--
-- and the last one matters as much as the rest: a warning that cannot be
-- withdrawn is a warning that means nothing a year from now.
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
  ('cccc0000-0000-0000-0000-000000000001', 'driver@test.local'),
  ('cccc0000-0000-0000-0000-000000000002', 'other@test.local')
  on conflict do nothing;

--------------------------------------------------------------------------------
\echo ''
\echo '1. Neither table is a write primitive'
--------------------------------------------------------------------------------
select assert(relrowsecurity, 'row level security is on for spot_signals')
  from pg_class where oid = 'public.spot_signals'::regclass;

select assert(count(*) = 0, 'spot_signals has no policies — the functions are the whole surface')
  from pg_policies where tablename = 'spot_signals';

select assert(count(*) = 0, 'anon and authenticated hold no privilege on spot_signals')
  from information_schema.role_table_grants
 where table_name = 'spot_signals' and grantee in ('anon', 'authenticated');

-- The raw rows say which anonymous source said what about which spot, which
-- assembled across spots is a movement history.
select assert(count(*) = 0, 'service_role is the only reader of the raw signals')
  from information_schema.role_table_grants
 where table_name = 'spot_signals' and grantee = 'anon' and privilege_type = 'SELECT';

-- The direct INSERT into spot_reports is gone. It had no shape check, no cap
-- and no dedupe, and leaving it beside the function would be the same as not
-- having written the function.
select assert(count(*) = 0, 'the ungated insert policy on spot_reports is withdrawn')
  from pg_policies where tablename = 'spot_reports';

select assert(count(*) = 0, 'anon and authenticated can no longer write spot_reports directly')
  from information_schema.role_table_grants
 where table_name = 'spot_reports' and grantee in ('anon', 'authenticated');

select assert(not rolbypassrls, 'authenticated does not bypass RLS')
  from pg_roles where rolname = 'authenticated';

select assert(
  (select prosecdef from pg_proc where oid = 'public.set_spot_signal(text,text,text)'::regprocedure),
  'set_spot_signal is SECURITY DEFINER');
select assert(
  (select proconfig::text like '%search_path=public, pg_temp%'
     from pg_proc where oid = 'public.set_spot_signal(text,text,text)'::regprocedure),
  'set_spot_signal pins its search_path');
select assert(
  (select prosecdef from pg_proc where oid = 'public.report_spot(text,text,text,text)'::regprocedure),
  'report_spot is SECURITY DEFINER');
select assert(
  (select proconfig::text like '%search_path=public, pg_temp%'
     from pg_proc where oid = 'public.report_spot(text,text,text,text)'::regprocedure),
  'report_spot pins its search_path');

select assert(has_function_privilege('anon', 'public.set_spot_signal(text,text,text)', 'execute'),
  'a guest can answer "is this still here?" — most drivers have no account');
select assert(has_function_privilege('anon', 'public.report_spot(text,text,text,text)', 'execute'),
  'a guest can report a spot');
select assert(has_function_privilege('anon', 'public.clear_spot_signal(text,text)', 'execute'),
  'a guest can take their answer back');

-- Resolving is a decision a human makes after looking, and the admin API
-- already holds the service key. A driver who could resolve reports could
-- silence every warning on the map.
select assert(not has_function_privilege('anon', 'public.resolve_spot_reports(text,text)', 'execute'),
  'anon cannot clear the flag on a spot');
select assert(not has_function_privilege('authenticated', 'public.resolve_spot_reports(text,text)', 'execute'),
  'a signed-in driver cannot clear the flag on a spot');
select assert(has_function_privilege('service_role', 'public.resolve_spot_reports(text,text)', 'execute'),
  'the admin API can clear it');

--------------------------------------------------------------------------------
\echo ''
\echo '2. One driver is one driver, however many times they tap'
--------------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', '', false);

select assert(set_spot_signal('spot-1', 'sess-a', 'confirmed') is not null,
  'a guest confirmation is accepted');
select set_spot_signal('spot-1', 'sess-a', 'confirmed');
select set_spot_signal('spot-1', 'sess-a', 'confirmed');
select set_spot_signal('spot-1', 'sess-a', 'confirmed');

select assert(count(*) = 1, 'four taps from one browser is one row')
  from spot_signals where spot_key = 'spot-1';
select assert(confirmed = 1, 'and one confirmation, not four')
  from spot_signal_counts where spot_key = 'spot-1';

select set_spot_signal('spot-1', 'sess-b', 'confirmed');
select set_spot_signal('spot-1', 'sess-c', 'confirmed');
select assert(confirmed = 3, 'three browsers is three confirmations')
  from spot_signal_counts where spot_key = 'spot-1';

-- Changing your mind MOVES the vote. Counting it on both sides would make a
-- spot look both well confirmed and widely disputed, which is worse than
-- knowing nothing about it.
select set_spot_signal('spot-1', 'sess-c', 'changed');
select assert(confirmed = 2 and changed = 1,
  'changing your mind moves the vote rather than adding to both sides')
  from spot_signal_counts where spot_key = 'spot-1';
select assert(count(*) = 1, 'and still only one row for that browser')
  from spot_signals where spot_key = 'spot-1' and source_id = 'sess-c';

-- created_at records when this driver FIRST said something about this spot;
-- updated_at is their latest answer. Collapsing the two loses the history.
select assert(created_at < updated_at, 'a changed answer keeps when it was first given')
  from spot_signals where spot_key = 'spot-1' and source_id = 'sess-c';

-- Taking it back removes the row. "No opinion" is the absence of a signal, not
-- a third kind of one.
select assert(clear_spot_signal('spot-1', 'sess-c'), 'an answer can be taken back');
select assert(confirmed = 2 and changed = 0, 'and it stops being counted')
  from spot_signal_counts where spot_key = 'spot-1';
select assert(not clear_spot_signal('spot-1', 'sess-c'),
  'clearing an answer that is not there reports that it was not there');

--------------------------------------------------------------------------------
\echo ''
\echo '3. Nothing that is not an answer gets in'
--------------------------------------------------------------------------------
select assert(set_spot_signal('spot-2', 'sess-a', 'brilliant') is null,
  'an invented signal is refused');
select assert(set_spot_signal(null, 'sess-a', 'confirmed') is null,
  'a signal about no spot is refused');
select assert(set_spot_signal('   ', 'sess-a', 'confirmed') is null,
  'a signal about a blank spot key is refused');
select assert(set_spot_signal(repeat('x', 101), 'sess-a', 'confirmed') is null,
  'an absurd spot key is refused rather than stored');
select assert(count(*) = 0, 'and none of those wrote a row')
  from spot_signals where spot_key in ('spot-2', '   ');

-- A caller with no session id gets a fresh source per call. We cannot tell
-- whether two unidentified taps are two people, and folding them into one
-- would throw away a real driver's answer.
select set_spot_signal('spot-3', null, 'confirmed');
select set_spot_signal('spot-3', '', 'confirmed');
select assert(confirmed = 2, 'two unidentified taps are counted as two, not folded into one')
  from spot_signal_counts where spot_key = 'spot-3';

-- The cap. One source voting on hundreds of spots is not a person walking
-- around Belfast.
do $$
declare i int;
begin
  for i in 1..205 loop
    perform set_spot_signal('bulk-' || i, 'flooder', 'confirmed');
  end loop;
end $$;
select assert(count(*) = 200, 'a single source is capped at 200 spots')
  from spot_signals where source_id = 'flooder';

-- And the one it has already voted on is still correctable. A driver at the cap
-- who finds a spot has changed must not be silently refused, or a wrong answer
-- freezes in place.
select assert((set_spot_signal('bulk-1', 'flooder', 'changed') ->> 'mine') = 'changed',
  'a source at the cap can still correct an answer it already gave');
select assert(changed = 1, 'and the correction lands')
  from spot_signal_counts where spot_key = 'bulk-1';

--------------------------------------------------------------------------------
\echo ''
\echo '4. The answer comes back, so the UI shows the real number'
--------------------------------------------------------------------------------
-- The old code incremented its own guess, which is exactly why "Confirmed by 1
-- driver" could be true on one phone and false everywhere else.
select assert((set_spot_signal('spot-4', 'sess-a', 'confirmed') ->> 'confirmed')::int = 1,
  'the function returns the count after the vote');
select assert((set_spot_signal('spot-4', 'sess-b', 'confirmed') ->> 'confirmed')::int = 2,
  'the second browser sees the first browser''s answer');
select assert((set_spot_signal('spot-4', 'sess-b', 'changed') ->> 'changed')::int = 1,
  'and its own change');
select assert((set_spot_signal('spot-4', 'sess-b', 'changed') ->> 'confirmed')::int = 1,
  'the confirmation that moved is no longer counted');
select assert((set_spot_signal('spot-4', 'sess-c', 'confirmed') ->> 'spot_key') = 'spot-4',
  'the payload says which spot it is about');

-- 30-day counts exist so the sheet can lead with "is this still true?" rather
-- than "how well known is it?".
select assert(confirmed_30d = 2 and changed_30d = 1, 'the recent counts match the all-time ones today')
  from spot_signal_counts where spot_key = 'spot-4';
update spot_signals set updated_at = now() - interval '200 days'
 where spot_key = 'spot-4' and source_id = 'sess-a';
select assert(confirmed = 2 and confirmed_30d = 1,
  'an answer from last year still counts all-time but not as recent')
  from spot_signal_counts where spot_key = 'spot-4';

--------------------------------------------------------------------------------
\echo ''
\echo '5. A signed-in driver''s answer is theirs, and nobody else''s'
--------------------------------------------------------------------------------
select set_config('request.jwt.claim.sub', 'cccc0000-0000-0000-0000-000000000001', false);
select set_spot_signal('spot-5', 'sess-signed', 'confirmed');
select assert(user_id = 'cccc0000-0000-0000-0000-000000000001',
  'a signal is attributed from auth.uid(), never from an argument')
  from spot_signals where spot_key = 'spot-5';

-- The function takes no user id, so there is no way to ask for somebody else's.
select assert(count(*) = 0, 'set_spot_signal accepts no user id argument at all')
  from information_schema.parameters
 where specific_name in (
         select specific_name from information_schema.routines
          where routine_name = 'set_spot_signal' and specific_schema = 'public')
   and data_type = 'uuid';

-- A guest's later answer on the same browser does not erase the account it was
-- first attributed to.
select set_config('request.jwt.claim.sub', '', false);
select set_spot_signal('spot-5', 'sess-signed', 'changed');
select assert(user_id = 'cccc0000-0000-0000-0000-000000000001',
  'signing out does not detach an answer already given')
  from spot_signals where spot_key = 'spot-5';

--------------------------------------------------------------------------------
\echo ''
\echo '6. The report flag counts people, not taps'
--------------------------------------------------------------------------------
select assert(report_spot('spot-6', 'sess-a', 'gone', 'Barrier went in'),
  'a report is accepted');
select report_spot('spot-6', 'sess-a', 'gone', 'Barrier went in');
select report_spot('spot-6', 'sess-a', 'gone', 'Barrier went in');
select report_spot('spot-6', 'sess-a', 'gone', 'Barrier went in');
select report_spot('spot-6', 'sess-a', 'gone', 'Barrier went in');

-- This is the defect the view had: five taps from one browser read to every
-- other driver as "5 drivers reported a problem here recently".
select assert(reports = 1, 'five taps from one browser is one reporter')
  from spot_report_counts where spot_key = 'spot-6';
select assert(count(*) = 1, 'and one open row, not five')
  from spot_reports where spot_key = 'spot-6' and resolved_at is null;

select report_spot('spot-6', 'sess-b', 'restricted', null);
select assert(reports = 2 and reports_30d = 2, 'a second browser is a second reporter')
  from spot_report_counts where spot_key = 'spot-6';

-- A second tap is a correction. The newer reason wins; when they first said so
-- is what the review queue sorts on, so created_at stays.
select report_spot('spot-6', 'sess-a', 'restricted', 'Permit zone now');
select assert(reason = 'restricted' and note = 'Permit zone now',
  'a second report from the same browser corrects the first')
  from spot_reports where spot_key = 'spot-6' and source_id = 'sess-a';
select assert(created_at <= now(), 'and keeps when it was first filed')
  from spot_reports where spot_key = 'spot-6' and source_id = 'sess-a';

-- An unknown reason is not a refusal. A driver who has taken the trouble to
-- report something must not lose it to a renamed constant in the client.
select assert(report_spot('spot-7', 'sess-a', 'whatever', null),
  'an unrecognised reason is still recorded');
select assert(reason = 'wrong', 'as the generic one')
  from spot_reports where spot_key = 'spot-7';
select assert(not report_spot(null, 'sess-a', 'gone', null), 'a report about no spot is refused');
select assert(not report_spot('   ', 'sess-a', 'gone', null), 'a report about a blank key is refused');

-- Notes are trimmed and bounded; an empty one is null rather than "".
select report_spot('spot-8', 'sess-a', 'gone', '   ');
select assert(note is null, 'a whitespace note is stored as nothing, not as a blank string')
  from spot_reports where spot_key = 'spot-8';
select report_spot('spot-9', 'sess-a', 'gone', repeat('z', 900));
select assert(length(note) = 500, 'a long note is capped rather than refused')
  from spot_reports where spot_key = 'spot-9';

-- The same cap, for the same reason.
do $$
declare i int;
begin
  for i in 1..105 loop
    perform report_spot('rbulk-' || i, 'rflooder', 'gone', null);
  end loop;
end $$;
select assert(count(*) = 100, 'a single source is capped at 100 open reports')
  from spot_reports where source_id = 'rflooder';

--------------------------------------------------------------------------------
\echo ''
\echo '7. The flag can be cleared, or it stops meaning anything'
--------------------------------------------------------------------------------
select assert(resolve_spot_reports('spot-6', 'Checked on site — barrier is open') = 2,
  'resolving closes every open report on the spot');
select assert(count(*) = 0, 'and the flag is gone')
  from spot_report_counts where spot_key = 'spot-6';
select assert(count(*) = 2, 'the reports are kept, not deleted — the history is the point')
  from spot_reports where spot_key = 'spot-6' and resolved_at is not null;
select assert(resolution = 'Checked on site — barrier is open', 'with what was decided')
  from spot_reports where spot_key = 'spot-6' and source_id = 'sess-b';
select assert(resolve_spot_reports('spot-6', null) = 0,
  'resolving twice closes nothing the second time');

-- A spot that was checked and has gone wrong AGAIN is a second report, not an
-- edit of the resolved one. The unique index is deliberately partial.
select assert(report_spot('spot-6', 'sess-a', 'gone', 'Barrier back'),
  'the same browser can report the spot again after it was resolved');
select assert(count(*) = 2, 'which is a new row beside the resolved one')
  from spot_reports where spot_key = 'spot-6' and source_id = 'sess-a';
select assert(reports = 1, 'and the flag counts only the open one')
  from spot_report_counts where spot_key = 'spot-6';

--------------------------------------------------------------------------------
\echo ''
\echo '8. The views hand out counts and nothing else'
--------------------------------------------------------------------------------
select assert(count(*) = 0, 'spot_signal_counts exposes no source id and no user id')
  from information_schema.columns
 where table_name = 'spot_signal_counts'
   and column_name in ('source_id', 'user_id');

select assert(count(*) = 0, 'spot_report_counts exposes no reporter and no note')
  from information_schema.columns
 where table_name = 'spot_report_counts'
   and column_name in ('reporter_id', 'source_id', 'note', 'resolution');

select assert(has_table_privilege('anon', 'public.spot_signal_counts', 'select'),
  'a guest can read the counts — the whole point is that they reach other drivers');
select assert(has_table_privilege('anon', 'public.spot_report_counts', 'select'),
  'a guest can read the report counts');
select assert(not has_table_privilege('anon', 'public.spot_signals', 'select'),
  'but not the rows behind them');

-- SELECT and nothing else. Supabase's default privileges grant ALL on every new
-- relation in public — views included — so without the revoke the migration
-- makes before its grant, anon also holds INSERT, UPDATE and DELETE on these.
-- Harmless today because an aggregating view is not auto-updatable, and exactly
-- the kind of thing that stops being harmless when somebody simplifies a view.
select assert(count(*) = 0, 'a guest holds nothing but SELECT on the counts views')
  from information_schema.role_table_grants
 where table_name in ('spot_signal_counts', 'spot_report_counts')
   and grantee in ('anon', 'authenticated')
   and privilege_type <> 'SELECT';

-- security_invoker = false: the view reads the table as its owner, which is the
-- only way a table nobody can select from can still produce public counts.
select assert(
  (select reloptions::text from pg_class where oid = 'public.spot_signal_counts'::regclass)
    not like '%security_invoker=true%',
  'the counts view is not security_invoker, or it returns nothing to a guest');

\echo ''
