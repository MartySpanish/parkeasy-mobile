-- Which gems the homepage is allowed to call Northern Irish.
--
-- The number on the homepage is a marketing claim, and the only failure that
-- matters here is the overstating one: counting a Dublin or Donegal gem as
-- Northern Irish is the mistake a stranger can disprove in one tap. So these
-- checks are weighted towards that direction — a gem wrongly left out costs a
-- smaller number, a gem wrongly counted costs the claim.
\set ON_ERROR_STOP on
set client_min_messages = notice;

create or replace function assert(p_cond boolean, p_what text)
returns void language plpgsql as $$
begin
  if p_cond then raise notice '  PASS  %', p_what;
  else raise exception 'FAIL  %', p_what;
  end if;
end $$;

-- A small stand-in for the live table's spread: Northern Ireland, the obvious
-- Republic (Dublin), and the two that matter — Donegal towns that sit INSIDE a
-- Northern Ireland bounding box and would be miscounted by geography alone.
insert into public.hidden_gems (legacy_id, name, near, town, lat, lng, status, restriction) values
  ('9001', 'Belfast one',  'Botanic',      'belfast',     54.5831, -5.9858, 'published', 'Free'),
  ('9002', 'Derry one',    'Foyleside',    'derry',       55.0030, -7.3300, 'published', 'Free'),
  ('9003', 'Enniskillen',  'Fermanagh',    'enniskillen', 54.3460, -7.6420, 'published', 'Free'),
  ('9004', 'Dublin one',   'Dollymount',   'dublin',      53.3300, -6.2800, 'published', 'Free'),
  ('9005', 'Galway one',   'Salthill',     'galway',      53.2600, -9.0700, 'published', 'Free'),
  -- County Donegal, inside the NI box. These two are the whole reason the
  -- classification is a town list and not a rectangle.
  ('9006', 'Malin Head',   'Inishowen',    'malin head',  55.3800, -7.3740, 'published', 'Free'),
  ('9007', 'Dunfanaghy',   'Sheephaven',   'dunfanaghy',  55.1880, -7.9650, 'published', 'Free'),
  -- A draft, to prove the count is of PUBLISHED gems only.
  ('9008', 'Draft one',    'Somewhere',    'belfast',     54.6000, -5.9000, 'draft', 'Free');

--------------------------------------------------------------------------------
\echo ''
\echo '0. The BACKFILL, on rows that existed before the migration'
--------------------------------------------------------------------------------
-- tests/db/gem_region_seed.sql put these in ahead of the migration. They are
-- the only rows in the suite the backfill actually touched — everything below
-- was inserted afterwards and classified by the trigger. Both paths need
-- covering separately: a backfill rewritten to use a bounding box passes every
-- trigger check in this file.
select assert((select region from public.hidden_gems where legacy_id = '8001') = 'NI',
  'backfill: a Belfast gem that predates the migration is NI');
select assert((select region from public.hidden_gems where legacy_id = '8003') = 'ROI',
  'backfill: a Dublin gem that predates the migration is ROI');
select assert((select region from public.hidden_gems where legacy_id = '8004') = 'ROI',
  'backfill: Malin Head is ROI — a bounding box would have said NI');
select assert((select region from public.hidden_gems where legacy_id = '8005') = 'ROI',
  'backfill: Dunfanaghy is ROI — a bounding box would have said NI');
select assert((select region from public.hidden_gems where legacy_id = '8002') = 'NI',
  'backfill: Derry is NI, not swept across the border with its neighbours');
select assert((select count(*) from public.hidden_gems where legacy_id like '80%' and premium is not true) = 0,
  'backfill: pre-existing gems with a null premium flag were fixed');

--------------------------------------------------------------------------------
\echo ''
\echo '1. Every gem is classified'
--------------------------------------------------------------------------------
select assert((select count(*) from public.hidden_gems where region is null) = 0,
  'no gem is left unclassified');

select assert((select region from public.hidden_gems where legacy_id = '9001') = 'NI',
  'a Belfast gem is NI');
select assert((select region from public.hidden_gems where legacy_id = '9004') = 'ROI',
  'a Dublin gem is ROI');

--------------------------------------------------------------------------------
\echo ''
\echo '2. The two Donegal towns a bounding box gets wrong'
--------------------------------------------------------------------------------
-- Both sit at lat 55.2-55.4, lng -8.0..-7.3 — comfortably inside any box drawn
-- round Northern Ireland, and in a different country.
select assert((select region from public.hidden_gems where legacy_id = '9006') = 'ROI',
  'Malin Head is ROI despite sitting inside the NI bounding box');
select assert((select region from public.hidden_gems where legacy_id = '9007') = 'ROI',
  'Dunfanaghy is ROI despite sitting inside the NI bounding box');

-- The inverse: the western NI towns a careless list might sweep into Donegal.
select assert((select region from public.hidden_gems where legacy_id = '9002') = 'NI',
  'Derry is NI, not swept up with its neighbours across the border');
select assert((select region from public.hidden_gems where legacy_id = '9003') = 'NI',
  'Enniskillen is NI');

--------------------------------------------------------------------------------
\echo ''
\echo '3. The count the homepage reads'
--------------------------------------------------------------------------------
select assert((select published_ni from public.hidden_gem_stats) = 5,
  'published_ni counts the published NI gems from both the seed and this file');
select assert((select published from public.hidden_gem_stats) = 12,
  'published still counts every published gem, both countries');
select assert((select published_ni from public.hidden_gem_stats)
            < (select published from public.hidden_gem_stats),
  'the NI figure is the smaller of the two — the homepage claim understates');
select assert((select towns_ni from public.hidden_gem_stats) = 3,
  'towns_ni counts NI towns only (belfast, derry, enniskillen)');

-- A draft is not on the homepage.
select assert((select count(*) from public.hidden_gems where status = 'draft') = 1,
  'the draft row exists');
select assert((select published_ni from public.hidden_gem_stats) = 5,
  'and is not counted — published_ni is published gems only');

--------------------------------------------------------------------------------
\echo ''
\echo '4. The constraint stops a third country appearing'
--------------------------------------------------------------------------------
do $$
begin
  begin
    update public.hidden_gems set region = 'GB' where legacy_id = '9001';
    raise exception 'FAIL  the region check accepted a value that is not NI or ROI';
  exception when check_violation then
    raise notice '  PASS  region rejects anything but NI or ROI';
  end;
end $$;

--------------------------------------------------------------------------------
\echo ''
\echo '5. premium is no longer three values for one fact'
--------------------------------------------------------------------------------
-- The backfill only fixes rows that existed the day it ran, so the check that
-- matters is the DEFAULT: without it the next gem lands null and the column
-- drifts straight back to three values for one fact.
select assert((select count(*) from public.hidden_gems where premium is null) = 0,
  'no gem is left with a null premium flag');
select assert((select column_default from information_schema.columns
                where table_schema='public' and table_name='hidden_gems'
                  and column_name='premium') like 'true%',
  'premium defaults to true, so a new gem cannot land unflagged');

-- Worth stating plainly, because the brief treated this column as a fix:
-- premium does NOTHING for a gem. isGated() in App.jsx returns true on
-- badge === 'hidden_gem' two lines before it reaches spot.premium, and RLS
-- gates the row regardless. This is hygiene, and the check above is what
-- keeps it hygienic.
select assert((select count(*) from public.hidden_gems where status='published' and not premium) = 0,
  'every published gem agrees it is Premium');

--------------------------------------------------------------------------------
\echo ''
\echo '6. New gems classify themselves, and an unknown town stays out'
--------------------------------------------------------------------------------
-- The whole point of the trigger. A one-off UPDATE would have fixed only the
-- rows that existed the day it ran; every gem added afterwards would land with
-- a null region, drop out of the homepage count, and nobody would notice the
-- number had stopped growing.
insert into public.hidden_gems (legacy_id, name, near, town, lat, lng, status, restriction)
values ('9101', 'New Lisburn gem', 'Market Sq', 'lisburn', 54.5100, -6.0400, 'published', 'Free');
select assert((select region from public.hidden_gems where legacy_id = '9101') = 'NI',
  'a gem inserted after the migration is classified on the way in');

-- Cork is in neither list. It must NOT default to NI: that is the original bug
-- with a new coat on, and it fails in the overstating direction.
insert into public.hidden_gems (legacy_id, name, near, town, lat, lng, status, restriction)
values ('9102', 'Cork gem', 'Douglas', 'cork', 51.8800, -8.4360, 'published', 'Free');
select assert((select region from public.hidden_gems where legacy_id = '9102') is null,
  'a town on neither list is left null, not assumed to be Northern Irish');
select assert((select published_ni from public.hidden_gem_stats) = 6,
  'and it is left out of the NI count rather than inflating it');

-- A human can still overrule the list, which is how an unknown town gets in.
update public.hidden_gems set region = 'ROI' where legacy_id = '9102';
select assert((select region from public.hidden_gems where legacy_id = '9102') = 'ROI',
  'an explicitly set region survives the trigger');

-- Moving a gem to another town reclassifies it.
update public.hidden_gems set region = null, town = 'dublin' where legacy_id = '9102';
select assert((select region from public.hidden_gems where legacy_id = '9102') = 'ROI',
  'clearing the region and changing the town reclassifies from the new town');

\echo ''
\echo 'gem region: all checks passed'
