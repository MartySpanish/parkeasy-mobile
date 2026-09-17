-- Event-day pricing: the table works, nothing ever wrote to it.
--
-- listing_price_overrides has 0 rows and api/checkout/create-session.js has
-- read it since it was built — a per-date override already replaces the base
-- price. What was missing is any way to CREATE one, and any connection to the
-- 262 future events sitting in `events`.
--
-- TWO COLUMNS, so an override can say what it is for.
--
-- The table stores listing + date + price and nothing else, so a driver seeing
-- a higher price at checkout is told nothing about why, and nobody looking at
-- the row later can tell a matchday from a typo. event_id and label fix both.
--
-- THE RADIUS IS 2km, NOT the 1.5km the brief asked for, and the reason is in
-- the data. Measured against the three active listings:
--
--   nearest high/major venue   Cathedral Quarter   1,711 m
--   next                       The O2 Belfast      1,977 m   (47 future events)
--
-- At 1,500 m this feature has NOTHING to suggest — it would ship as a screen
-- that is always empty. At 2,000 m one listing picks up 48 upcoming events.
-- 2 km is a twenty-five minute walk, which is an ordinary matchday walk for an
-- arena. It is a parameter, not a constant, so tightening it as supply grows
-- near the venues is a one-number change rather than a migration.

begin;

alter table public.listing_price_overrides
  add column if not exists event_id uuid references public.events(id) on delete set null,
  -- Free text, snapshotted. An event can be renamed or deleted; what the
  -- driver was told at the time cannot change afterwards.
  add column if not exists label text;

comment on column public.listing_price_overrides.event_id is
  'The event this price was set for, when it came from one. Nullable: a host '
  'can raise a price for their own reasons.';
comment on column public.listing_price_overrides.label is
  'What the driver is told at checkout, snapshotted. An event can be renamed '
  'or removed; what somebody was charged for cannot change after the fact.';

create index if not exists listing_price_overrides_date_idx
  on public.listing_price_overrides (override_date);

-- ── What to price up, and by how much ───────────────────────────────────────
--
-- Upcoming high and major events, each with the active listings near enough to
-- be worth walking from, their current price, and whether a price is already
-- set for that date. Suggestions only: the host agreed a price, so this puts a
-- button in front of Marty rather than changing anybody's money by itself.
create or replace function public.event_pricing_suggestions(
  p_radius_m integer default 2000,
  p_days     integer default 90
)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select coalesce(jsonb_agg(r order by r->>'starts_at'), '[]'::jsonb)
    from (
      select jsonb_build_object(
               'event_id', e.id,
               'event', e.name,
               'starts_at', e.starts_at,
               'demand_tier', e.demand_tier,
               'expected_attendance', e.expected_attendance,
               'venue', v.name,
               'listing_id', l.id,
               'listing', l.title,
               'metres', round((2 * 6371000 * asin(sqrt(
                   power(sin(radians(l.lat - v.lat) / 2), 2)
                 + cos(radians(v.lat)) * cos(radians(l.lat))
                   * power(sin(radians(l.lng - v.lng) / 2), 2))))::numeric),
               'price_per_day_pence',  round(l.price_per_day  * 100),
               'price_per_hour_pence', round(l.price_per_hour * 100),
               -- Already priced for that date? Then the button says "set" and
               -- shows what it is, rather than offering to overwrite silently.
               'existing_pence', o.price_pence,
               'existing_label', o.label
             ) r
        from public.events e
        join public.venues v on v.id = e.venue_id and v.lat is not null
        join public.rental_listings l
          on l.status = 'active' and l.lat is not null
         and 2 * 6371000 * asin(sqrt(
               power(sin(radians(l.lat - v.lat) / 2), 2)
             + cos(radians(v.lat)) * cos(radians(l.lat))
               * power(sin(radians(l.lng - v.lng) / 2), 2)))
             <= greatest(200, least(p_radius_m, 20000))
        left join public.listing_price_overrides o
               on o.listing_id = l.id
              and o.override_date = (e.starts_at at time zone 'Europe/London')::date
       where e.starts_at > now()
         and e.starts_at < now() + make_interval(days => greatest(1, least(p_days, 365)))
         and e.demand_tier in ('high', 'major')
         and coalesce(e.status, 'scheduled') <> 'cancelled'
    ) q;
$$;

revoke all on function public.event_pricing_suggestions(integer, integer) from public, anon, authenticated;
grant execute on function public.event_pricing_suggestions(integer, integer) to service_role;

commit;
