-- Partner tiers, and the one thing this migration must not do.
--
-- Eleven partners are live with cards showing. The tier column is null on all
-- of them, so a sensible default of 'listed' would have pulled every one of
-- those cards the moment this shipped — a barber ringing to ask where his
-- listing went. Most of these checks are about that.
\set ON_ERROR_STOP on
set client_min_messages = notice;

create or replace function assert(p_cond boolean, p_what text)
returns void language plpgsql as $$
begin
  if p_cond then raise notice '  PASS  %', p_what;
  else raise exception 'FAIL  %', p_what;
  end if;
end $$;

--------------------------------------------------------------------------------
\echo ''
\echo '1. Nobody who had a card yesterday lost it today'
--------------------------------------------------------------------------------
-- These came from tests/db/partner_tiers_seed.sql, inserted BEFORE the
-- migration with a null tier — exactly the live rows' shape.
select assert((select tier from public.partners where slug = 'pre-active-1') = 'featured',
  'backfill: a live partner was grandfathered into a card');
select assert((select tier from public.partners where slug = 'pre-active-2') = 'featured',
  'backfill: so was the second one');
select assert((select count(*) from public.partners
                where active and tier not in ('featured', 'sponsored')) = 0,
  'no active partner was left without a card');

-- An inactive partner that never launched is a free listing, not a paid one.
select assert((select tier from public.partners where slug = 'pre-inactive') = 'listed',
  'a partner that was never live is listed, not handed a paid tier');

--------------------------------------------------------------------------------
\echo ''
\echo '2. A new partner does not arrive holding a paid placement'
--------------------------------------------------------------------------------
insert into public.partners (slug, name, tagline, lat, lng, active)
values ('brand-new', 'Brand New Cafe', 'Coffee', 54.59, -5.93, true);
select assert((select tier from public.partners where slug = 'brand-new') = 'listed',
  'a new partner defaults to the free tier');

select assert((select column_default from information_schema.columns
                where table_schema='public' and table_name='partners' and column_name='tier')
              like '''listed''%',
  'the tier default is listed');

--------------------------------------------------------------------------------
\echo ''
\echo '3. The column cannot hold a tier the app has never heard of'
--------------------------------------------------------------------------------
do $$
begin
  begin
    update public.partners set tier = 'platinum' where slug = 'brand-new';
    raise exception 'FAIL  the tier column accepted a value the app does not know';
  exception when check_violation then
    raise notice '  PASS  an unknown tier is refused';
  end;
end $$;

do $$
begin
  begin
    update public.partners set tier = null where slug = 'brand-new';
    raise exception 'FAIL  the tier column accepted null';
  exception when not_null_violation then
    raise notice '  PASS  tier cannot be set back to null — that is what caused this';
  end;
end $$;

--------------------------------------------------------------------------------
\echo ''
\echo '4. The card query'
--------------------------------------------------------------------------------
update public.partners set tier = 'sponsored' where slug = 'pre-active-2';

select assert((select count(*) from public.partners
                where tier in ('featured', 'sponsored')) = 2,
  'two partners are on a paying tier');
select assert((select count(*) from public.partners where tier = 'listed') = 2,
  'and two are free listings that render no card');

select assert(exists (select 1 from pg_indexes
                where tablename = 'partners' and indexname = 'partners_paid_tier_idx'),
  'the paying-tier index exists');

\echo ''
\echo 'partner tiers: all checks passed'
