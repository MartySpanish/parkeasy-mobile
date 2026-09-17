-- Which country a gem is in, so the homepage can stop overstating the network.
--
-- THE BUG THIS FIXES. The homepage says "N hidden gems ... across Northern
-- Ireland". N came from the bundled fallback array and read 89. The live table
-- holds 133 published gems, so the page was understating by a third — but
-- swapping 89 for 133 would have been worse than leaving it, because 28 of
-- those gems are in the Republic: Dublin, Galway, Sligo, Mayo and Donegal.
-- "133 gems across Northern Ireland" is a claim a stranger from Dublin can
-- disprove in one tap.
--
-- So the count has to be region-aware, and region has to be a fact on the row
-- rather than something guessed at read time.
--
-- WHY NOT A BOUNDING BOX. That was the first attempt and it is subtly wrong.
-- A box round Northern Ireland (lat 54.0-55.4, lng -8.2..-5.4) also contains
-- Malin Head and Dunfanaghy, which are County Donegal — so the box answered
-- 107 when the truth is 105. Two gems is not a rounding error when the number
-- is a marketing claim, and the error is in the overstating direction, which
-- is the one that matters.
--
-- WHY NOT NOT NULL WITH A DEFAULT. A default of 'NI' would silently label the
-- next Dublin gem as Northern Irish, which is this same bug reintroduced by
-- the schema. region stays nullable; an unclassified gem is simply left out of
-- the NI count. Understating is the safe direction — see the same rule in
-- scripts/prerender.mjs.

begin;

alter table public.hidden_gems
  add column if not exists region text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'hidden_gems_region_check') then
    alter table public.hidden_gems
      add constraint hidden_gems_region_check check (region is null or region in ('NI', 'ROI'));
  end if;
end $$;

comment on column public.hidden_gems.region is
  'NI or ROI. Nullable on purpose: an unclassified gem is excluded from the '
  'Northern Ireland count rather than assumed to be in it.';

-- Classification lives in a function, not in a one-off UPDATE, because the
-- UPDATE would only ever have fixed the rows that existed the day it ran.
-- Every gem added afterwards would land with region null, drop out of the
-- homepage count, and nobody would notice the number had quietly stopped
-- growing. The trigger below applies the same function on the way in.
--
-- BOTH lists are explicit and an unknown town returns NULL. Defaulting the
-- unknown case to 'NI' is the original bug with a new coat on: the first Cork
-- gem somebody adds would be counted as Northern Irish. Null means "not
-- counted yet", which costs a smaller number and never costs the claim.
create or replace function public.gem_region_for_town(p_town text)
returns text
language sql
immutable
as $$
  select case
    -- The Republic. Every town here was read off the live table and checked
    -- against its own coordinates — including the two Donegal ones that sit
    -- INSIDE a Northern Ireland bounding box (Malin Head, Dunfanaghy), and
    -- Newport, which is the Mayo one; there is no Newport in the NI rows.
    when lower(trim(p_town)) in (
      'achill', 'ballina', 'barna', 'bundoran', 'castlebar', 'creeslough',
      'dollymount', 'drumcliff', 'dublin', 'dun laoghaire', 'dunfanaghy',
      'galway', 'glencar', 'howth', 'killiney', 'louisburgh', 'malahide',
      'malin head', 'mulranny', 'newport', 'oranmore', 'portmarnock', 'raheny',
      'rosses point', 'sandycove', 'sandymount', 'sligo', 'strandhill',
      'westport'
    ) then 'ROI'
    when lower(trim(p_town)) in (
      'antrim', 'armagh', 'ballycastle', 'ballymena', 'ballymoney',
      'ballynahinch', 'banbridge', 'bangor', 'belfast', 'carrickfergus',
      'coleraine', 'comber', 'cookstown', 'craigavon', 'derry', 'downpatrick',
      'dungannon', 'enniskillen', 'holywood', 'kilkeel', 'larne', 'limavady',
      'lisburn', 'londonderry', 'magherafelt', 'newcastle', 'newry',
      'newtownabbey', 'newtownards', 'omagh', 'portadown', 'portrush',
      'portstewart', 'strabane', 'warrenpoint'
    ) then 'NI'
    else null
  end;
$$;

update public.hidden_gems
   set region = public.gem_region_for_town(town)
 where region is null;

create or replace function public.hidden_gems_set_region()
returns trigger language plpgsql as $$
begin
  -- Only fills a blank. An explicitly set region is a human overruling the
  -- list, which is how a town the list has never heard of gets counted.
  if new.region is null then
    new.region := public.gem_region_for_town(new.town);
  end if;
  return new;
end $$;

drop trigger if exists hidden_gems_region_trg on public.hidden_gems;
create trigger hidden_gems_region_trg
  before insert or update of town, region on public.hidden_gems
  for each row execute function public.hidden_gems_set_region();

-- The 16 gems with premium = null.
--
-- The brief asked for these to be decided true or false. Worth recording what
-- the column actually does before anyone treats this as a fix: for a gem it
-- does NOTHING. isGated() in App.jsx returns true on `badge === 'hidden_gem'`
-- two lines before it ever reaches `spot.premium === true`, and every row from
-- this table is mapped to that badge. The column only bites on bundled
-- non-gem spots — the premium-flagged EV picks.
--
-- So this is data hygiene, not a behaviour change: every published gem is
-- Premium-gated by RLS regardless, and the column should say so rather than
-- being three different values for one fact. The column is a candidate for
-- removal once the bundled EV picks move into the database too.
update public.hidden_gems set premium = true where premium is null;

-- And a default, for the same reason 20260823_no_free_tasters.sql gave
-- is_taster one: a backfill only ever fixes the rows that exist the day it
-- runs. Without this the next gem lands as null and the column drifts back to
-- three values for one fact.
alter table public.hidden_gems alter column premium set default true;

-- The count the homepage reads.
create or replace view public.hidden_gem_stats as
  select count(*)                                          as published,
         count(*) filter (where verified_at is not null)    as verified,
         count(distinct town)                              as towns,
         count(*) filter (where region = 'NI')             as published_ni,
         count(distinct town) filter (where region = 'NI') as towns_ni
    from public.hidden_gems
   where status = 'published';

do $$
declare
  bad integer;
  ni  integer;
begin
  -- Nothing unclassified TODAY. This is an assertion about the data that
  -- exists, not a constraint: a future gem in a town the list has never heard
  -- of is allowed to be null and simply sits out of the count until somebody
  -- adds its town. What must not happen is this migration leaving the 156 rows
  -- it was written for half-classified.
  select count(*) into bad from public.hidden_gems where region is null;
  if bad > 0 then
    raise exception '% existing gems have no region — the town lists are missing a town', bad;
  end if;

  -- Geography has to agree with the town list. Every NI gem must sit inside a
  -- Northern Ireland box; a mistyped town would show up here rather than in a
  -- marketing claim three months from now.
  select count(*) into bad from public.hidden_gems
   where region = 'NI'
     and not (lat between 54.0 and 55.4 and lng between -8.2 and -5.4);
  if bad > 0 then
    raise exception '% gems are labelled NI but sit outside Northern Ireland', bad;
  end if;

  -- The view has to answer, and it can never claim more NI gems than there are
  -- gems. Deliberately not asserting a minimum: this migration must also apply
  -- cleanly to an empty table, which is what every test cluster starts from,
  -- and "at least one" would pass in production while failing there for a
  -- reason that has nothing to do with the change.
  select published_ni into ni from public.hidden_gem_stats;
  if ni is null then
    raise exception 'published_ni came back null — the view is not counting';
  end if;
  if ni > (select published from public.hidden_gem_stats) then
    raise exception 'published_ni (%) exceeds published — the filter is inverted', ni;
  end if;
  raise notice 'hidden gems: % published in Northern Ireland', ni;
end $$;

commit;
