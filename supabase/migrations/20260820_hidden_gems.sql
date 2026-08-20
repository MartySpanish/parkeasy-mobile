-- Hidden gems, out of app code and into the database.
--
-- NOT YET APPLIED to production.
--
-- WHY THIS IS THE ONE THAT UNBLOCKS EVERYTHING. The 89 curated free spots live
-- in a JavaScript array in App.jsx. That means they cannot be counted without a
-- deploy, cannot be joined to a listing, cannot be added by a human, and cannot
-- be moderated. Every downstream feature — the public count, the cluster map,
-- the free-to-paid funnel, the submission publish flow — needs them queryable.
--
-- AND IT CLOSES A REAL HOLE. Gems are the paid half of Premium, and today every
-- one of them ships to every browser in the JavaScript bundle. The lock is
-- drawn in the UI; the exact coordinates and notes are one devtools tab away
-- for anybody who has never paid. Moving them behind RLS is the first time that
-- gate has actually existed.

--------------------------------------------------------------------------------
-- 1. The table
--------------------------------------------------------------------------------
create table if not exists public.hidden_gems (
  id                   uuid primary key default gen_random_uuid(),
  -- THE LOAD-BEARING COLUMN. spot_occupancy.spot_id and
  -- spot_capacity_reports.spot_id hold a bare integer for a gem and
  -- 'rental-<uuid>' for a listing. That dual shape is the bridge between free
  -- and paid inventory and it is deliberately NOT being changed to a uuid FK.
  -- legacy_id is what keeps the integer half joinable.
  legacy_id            text unique,
  name                 text not null,
  near                 text,
  street               text,
  type                 text,
  -- REQUIRED. "Free parking" with no enforcement hours is not a spot, it is a
  -- ticket. Enforced at publish rather than at insert, so a half-finished draft
  -- can exist while somebody works it out.
  restriction          text not null,
  notes                text,
  lat                  double precision not null,
  lng                  double precision not null,
  photo_url            text,
  spaces_estimate      integer,
  land_type            text not null default 'public'
                         check (land_type in ('public','private')),
  status               text not null default 'draft'
                         check (status in ('draft','published','retired')),
  verified_at          timestamptz,
  verified_by          uuid references auth.users(id) on delete set null,
  source_submission_id uuid references public.spot_submissions(id) on delete set null,
  -- ── Carried from the app data, not invented ──────────────────────────────
  -- The client builds a spot object with these fields and the whole point of
  -- this migration is that the API shape does not change. Dropping them would
  -- mean rewriting the client in the same PR, which is exactly what the brief
  -- says not to do.
  tags                 text[] not null default '{}',
  walk                 text,
  dist_miles           numeric(5,2),
  submitted_by         text,          -- the app's `by` field: "Antrim Local"
  votes                integer not null default 0,
  premium              boolean,
  town                 text,          -- the CITY_SPOTS key: belfast, derry, …
  -- The five gems given away free, app-wide, as proof the locked ones are worth
  -- paying for. This was a derived rule in app code (top five by votes); it is a
  -- column now because it is a commercial decision, not a computation, and
  -- because the teaser view has to know which rows it may show in full.
  is_taster            boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  -- Who signed off publishing this despite it being on private land, and when.
  -- Null for every ordinary gem.
  private_land_approved_by text,

  -- A published gem must say what the restrictions are, and must not be on
  -- private land UNLESS somebody has explicitly signed that off. Both are
  -- conditional on status for the same reason: the person typing a draft is not
  -- the person deciding to publish it.
  --
  -- THE OVERRIDE IS A COLUMN, NOT A DELETED RULE. Marty's call on 19 August was
  -- to publish the five retail-land gems that have been live for months. The
  -- lazy way to honour that is to drop the constraint or relabel them 'public',
  -- and both would mean the NEXT private car park somebody submits gets
  -- published by accident — with a driver clamped at the end of it. This keeps
  -- the rule doing its job for everything new, and turns the exception into a
  -- signature somebody can be asked about.
  constraint hidden_gems_restriction_on_publish
    check (status <> 'published' or length(trim(restriction)) >= 3),
  constraint hidden_gems_no_private_publish
    check (status <> 'published'
           or land_type <> 'private'
           or private_land_approved_by is not null)
);

create index if not exists hidden_gems_status_idx on public.hidden_gems (status);
create index if not exists hidden_gems_town_idx   on public.hidden_gems (town) where status = 'published';
create index if not exists hidden_gems_geo_idx    on public.hidden_gems (lat, lng) where status = 'published';

create or replace function public.hidden_gems_touch()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists hidden_gems_touch_t on public.hidden_gems;
create trigger hidden_gems_touch_t before update on public.hidden_gems
  for each row execute function public.hidden_gems_touch();

--------------------------------------------------------------------------------
-- 2. Who is a Premium subscriber
--------------------------------------------------------------------------------
-- Entitlement is a promo_redemptions row with a future expires_at. There is no
-- subscriptions table; STRIPE-SUB is the paid code and PARKEZ / SPOT-THANKS are
-- grants. All three count — a hidden-gem reward IS Premium for its duration.
--
-- MATCHES ON user_id OR EMAIL, and both are needed. Of the ten live STRIPE-SUB
-- rows, one has no user_id: Premium bought through a Stripe payment link is
-- linked by the address the buyer typed, and the backfill only finds an auth
-- user if one exists at the time. Keying on user_id alone would silently
-- un-Premium a paying subscriber.
--
-- SECURITY DEFINER because promo_redemptions has its own RLS; a policy that
-- could not read it would return false for everybody.
create or replace function public.has_premium()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.promo_redemptions r
     where r.expires_at > now()
       and (
         r.user_id = auth.uid()
         or (auth.jwt() ->> 'email') is not null
            and lower(r.user_email) = lower(auth.jwt() ->> 'email')
       )
  );
$$;

grant execute on function public.has_premium() to anon, authenticated;

--------------------------------------------------------------------------------
-- 3. RLS — the gate that has never actually existed
--------------------------------------------------------------------------------
alter table public.hidden_gems enable row level security;

-- Published gems, to subscribers only. Drafts and retired rows are invisible to
-- everyone; the admin screens read with the service key.
drop policy if exists hidden_gems_premium_read on public.hidden_gems;
create policy hidden_gems_premium_read on public.hidden_gems
  for select using (status = 'published' and public.has_premium());

revoke all on public.hidden_gems from anon;
grant select on public.hidden_gems to authenticated;

-- WHAT A NON-SUBSCRIBER MAY SEE, and no more.
--
-- The app has always shown locked gems as a teaser: an approximate pin, the
-- area name, and an Unlock button — never the name, the exact location or the
-- notes. That behaviour is the upsell and it has to survive, so it gets its own
-- view rather than a hole in the policy above.
--
-- The coordinate is snapped to the SAME grid the client already uses for locked
-- pins (approxCoord in App.jsx: Math.round(v * 200) / 200, i.e. 0.005° ≈ 500m).
-- Snapped in SQL, so the exact figure never leaves the database at all — which
-- is the difference between this and what shipped before.
create or replace view public.hidden_gems_teaser
with (security_invoker = false) as
select
  id,
  legacy_id,
  near,
  town,
  spaces_estimate,
  is_taster,
  -- A taster is deliberately given away, so it carries its real detail. Every
  -- other gem gives up nothing but its area.
  case when is_taster then name end        as name,
  case when is_taster then restriction end as restriction,
  case when is_taster then notes end       as notes,
  case when is_taster then tags else '{}'::text[] end as tags,
  case when is_taster then walk end        as walk,
  case when is_taster then lat  else round((lat * 200)::numeric)::double precision / 200 end as approx_lat,
  case when is_taster then lng  else round((lng * 200)::numeric)::double precision / 200 end as approx_lng
from public.hidden_gems
where status = 'published';

grant select on public.hidden_gems_teaser to anon, authenticated;

comment on view public.hidden_gems_teaser is
  'What a non-subscriber may see of a hidden gem: the area and a pin snapped to '
  'a ~500m grid. Deliberately no name, no notes, no restriction, no photo and no '
  'exact coordinate — those are the thing Premium buys.';

-- The public count. A number, available to everybody, without exposing a row.
create or replace view public.hidden_gem_stats
with (security_invoker = false) as
select
  count(*)                                              as published,
  count(*) filter (where verified_at is not null)       as verified,
  count(distinct town)                                  as towns
from public.hidden_gems
where status = 'published';

grant select on public.hidden_gem_stats to anon, authenticated;

--------------------------------------------------------------------------------
-- 4. resolve_spot — the bridge between free and paid inventory
--------------------------------------------------------------------------------
-- spot_occupancy.spot_id holds three things in practice, not two, and the third
-- is the one that would have been silently dropped:
--
--   'rental-<uuid>'  a bookable listing
--   an integer that matches a gem's legacy_id
--   an integer that matches NOTHING here — because it is an ordinary free,
--     timed or official spot that still lives in app code. Four of the fourteen
--     live ids are exactly this: 25 (Queens Road, free), 43 (Connswater, free),
--     16 (NCP Dublin Road, official) and 26 (University Road, timed). The
--     "I'm heading there" button is offered on every free spot, not only gems,
--     so this was always going to happen.
--
-- Returning 'unknown' for that third case rather than null is the point: a
-- caller can tell "we do not have this one in the database yet" apart from
-- "this id is nonsense", and nobody writes a join that quietly loses a quarter
-- of the occupancy data.
create or replace function public.resolve_spot(p_spot_id text)
returns table (kind text, gem_id uuid, listing_id uuid, name text, lat double precision, lng double precision)
language plpgsql stable security definer
set search_path = public, pg_temp
as $$
begin
  if p_spot_id is null then
    return;
  elsif p_spot_id like 'rental-%' then
    return query
      select 'listing'::text, null::uuid, l.id, l.title, l.lat, l.lng
        from public.rental_listings l
       where l.id = nullif(substring(p_spot_id from 8), '')::uuid;
    if found then return; end if;
    return query select 'unknown'::text, null::uuid, null::uuid, null::text, null::double precision, null::double precision;
    return;
  else
    return query
      select 'gem'::text, g.id, null::uuid, g.name, g.lat, g.lng
        from public.hidden_gems g
       where g.legacy_id = p_spot_id;
    if found then return; end if;
    -- A real report against a spot that is still only in app code.
    return query select 'legacy_spot'::text, null::uuid, null::uuid, null::text, null::double precision, null::double precision;
    return;
  end if;
end $$;

grant execute on function public.resolve_spot(text) to authenticated, service_role;
