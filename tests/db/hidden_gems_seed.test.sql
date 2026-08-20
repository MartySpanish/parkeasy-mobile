-- The seed, and the join it exists to protect.
\set ON_ERROR_STOP on
set client_min_messages = notice;

create or replace function assert(p_cond boolean, p_what text)
returns void language plpgsql as $$
begin
  if p_cond then raise notice '  PASS  %', p_what;
  else raise exception 'FAIL  %', p_what;
  end if;
end $$;

\echo ''
\echo '1. The seed lands'
select assert((select count(*) from public.hidden_gems) = 89, 'all 89 gems inserted');
select assert((select count(*) from public.hidden_gems where status='published') = 89,
  'all 89 published — including the five on retail land, at Marty''s instruction');
select assert((select count(*) from public.hidden_gems where land_type='private') = 5,
  'and those five are still MARKED private, not quietly relabelled public to pass a constraint');
select assert(
  (select count(*) from public.hidden_gems where land_type='private' and private_land_approved_by is null) = 0,
  'every one of them carries a named sign-off');
select assert((select count(*) from public.hidden_gems where legacy_id is null) = 0,
  'every gem carries its legacy_id');
select assert((select count(distinct legacy_id) from public.hidden_gems) = 89,
  'and they are unique');
select assert((select count(*) from public.hidden_gems where trim(restriction) = '') = 0,
  'every gem has a restriction recorded');
select assert((select count(distinct town) from public.hidden_gems) = 24, 'across 24 towns');

\echo ''
\echo '2. Rerunning the seed corrects rather than duplicates'
-- Simulate a hand-edit being undone by a regenerate.
update public.hidden_gems set name = 'WRONG' where legacy_id = '66';
\i /tmp/pe-seed.sql
select assert((select count(*) from public.hidden_gems) = 89, 'still 89 rows after a second run');
select assert((select name from public.hidden_gems where legacy_id='66') <> 'WRONG',
  'and the row was corrected back');

\echo ''
\echo '2b. A rerun must not undo a moderation decision'
-- Marty later confirms Bann Boulevard really is a council car park, so the
-- private flag and the override come off.
update public.hidden_gems set land_type='public', private_land_approved_by=null where legacy_id='2137';
\i /tmp/pe-seed.sql
select assert(
  (select status from public.hidden_gems where legacy_id='2137') = 'published',
  'a published gem stays published through a regenerate');
select assert(
  (select land_type from public.hidden_gems where legacy_id='2137') = 'public',
  'and the land_type decision is not reset under it');
select assert(
  (select private_land_approved_by from public.hidden_gems where legacy_id='2137') is null,
  'nor is a withdrawn sign-off quietly reinstated');
select assert((select count(*) from public.hidden_gems where status='published') = 89,
  'so the published count reflects the human decisions, not the generator');

\echo ''
\echo '3. THE JOIN THIS WHOLE MIGRATION EXISTS TO PROTECT'
-- The 14 distinct non-rental spot_ids live in production today.
create temp table live_ids (spot_id text);
insert into live_ids values ('66'),('36'),('300'),('30'),('25'),('54'),('27'),('43'),('60'),('16'),('26'),('46'),('24'),('2007');

select assert(
  (select count(*) from live_ids l join public.hidden_gems g on g.legacy_id = l.spot_id) = 10,
  '10 of the 14 live spot ids join straight to a gem');

-- The other four are NOT missing data — they are free, timed and official spots
-- that were never gems. The "I'm heading there" button is offered on every free
-- spot, so occupancy was always going to reference them. resolve_spot() calls
-- them legacy_spot rather than dropping them.
select assert(
  (select count(*) from live_ids l where not exists
     (select 1 from public.hidden_gems g where g.legacy_id = l.spot_id)) = 4,
  'the remaining 4 are not gems — 25, 43 (free), 16 (official), 26 (timed)');

do $$
declare r record; v_kind text;
begin
  for r in select spot_id from live_ids loop
    select kind into v_kind from public.resolve_spot(r.spot_id);
    if v_kind is null then
      raise exception 'FAIL  resolve_spot returned nothing for %', r.spot_id;
    end if;
  end loop;
  perform assert(true, 'and resolve_spot answers for every one of the 14 — nothing silently dropped');
end $$;

\echo ''
\echo 'ALL CHECKS PASSED'
