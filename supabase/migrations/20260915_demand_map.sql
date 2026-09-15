-- Where people want parking and cannot get it.
--
-- THE SENTENCE THIS EXISTS TO MAKE SAYABLE: "eleven people looked for parking
-- near your club last month and there was nothing to book." That is the line
-- that makes a treasurer say yes, and right now nobody can say it, because the
-- evidence is spread across four tables and none of them is grouped by place.
--
-- FOUR SOURCES, and they are not equally strong:
--
--   parking_requests   somebody typed their EMAIL in. The strongest signal
--                      there is — they want telling when a space opens.
--   search_no_results  somebody searched and there was nothing bookable.
--                      Volume, and the top of the same funnel.
--   gem_locked_view    somebody hit the Premium wall on a gem. Demand for that
--                      AREA, and a different product question.
--   spot_occupancy     somebody actually parked at a free spot. Proof the area
--                      has demand, from people who solved it themselves.
--
-- They are counted separately and never summed into one number. A single
-- "demand score" mixing an email address with a map pan would be a number
-- nobody could defend in front of the committee it is meant to persuade.
--
-- CLUSTERED TO ~1.1km (two decimal places). Fine enough that Ormeau and
-- Botanic are different rows; coarse enough that nothing here points at a
-- doorstep, and that a handful of requests in one area read as one place
-- rather than five scattered pins.

begin;

-- ── Demand, grouped by place ────────────────────────────────────────────────
create or replace function public.demand_points(p_days integer default 90)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  with win as (select greatest(1, least(p_days, 365)) as d),
  -- Every source reduced to the same shape: a rounded point, a label, a count.
  pts as (
    select round(lat::numeric, 2) as lat, round(lng::numeric, 2) as lng,
           'request'::text as kind, destination as label, 1 as n
      from public.parking_requests, win
     where lat is not null and created_at > now() - make_interval(days => win.d)

    union all
    select round((props ->> 'lat')::numeric, 2), round((props ->> 'lng')::numeric, 2),
           'no_results', coalesce(props ->> 'query', town), 1
      from public.app_events, win
     where event_name = 'search_no_results'
       and props ? 'lat'
       and created_at > now() - make_interval(days => win.d)

    -- gem_locked_view carries no coordinates of its own — it is a tap on a
    -- card, not a search — so it is located by the gem it was about. Joined
    -- through listing_id being null and the town only, it would be useless, so
    -- it is deliberately counted by TOWN rather than placed on the map.
    union all
    select round(g.lat::numeric, 2), round(g.lng::numeric, 2),
           'parked', g.name, 1
      from public.spot_occupancy o
      join public.hidden_gems g on g.legacy_id = o.spot_id
      cross join win
     -- started_at, not created_at: this table records a parking SESSION, and
     -- has no created_at column at all.
     where o.started_at > now() - make_interval(days => win.d)
  )
  select coalesce(jsonb_agg(r order by (r->>'requests')::int desc, (r->>'total')::int desc), '[]'::jsonb)
    from (
      select jsonb_build_object(
               'lat', p.lat, 'lng', p.lng,
               -- The commonest label at that point, so a cluster is named
               -- after the place people were actually looking for.
               'label', (array_agg(p.label order by p.label))[1],
               'requests',   count(*) filter (where p.kind = 'request'),
               'no_results', count(*) filter (where p.kind = 'no_results'),
               'parked',     count(*) filter (where p.kind = 'parked'),
               'total',      count(*),
               -- The nearest venue, when there is one within 2km. This is what
               -- turns a pin into "near Windsor Park", which is how you find
               -- the club to ring.
               'venue', (
                 select v.name from public.venues v
                  where v.lat is not null
                    and 2 * 6371000 * asin(sqrt(
                          power(sin(radians(v.lat - p.lat::double precision) / 2), 2)
                        + cos(radians(p.lat::double precision)) * cos(radians(v.lat))
                          * power(sin(radians(v.lng - p.lng::double precision) / 2), 2))) < 2000
                  order by 2 * 6371000 * asin(sqrt(
                          power(sin(radians(v.lat - p.lat::double precision) / 2), 2)
                        + cos(radians(p.lat::double precision)) * cos(radians(v.lat))
                          * power(sin(radians(v.lng - p.lng::double precision) / 2), 2)))
                  limit 1),
               -- Is there already something bookable here? A cluster with a
               -- live listing beside it is demand being served; one without is
               -- the reason to go knocking.
               'has_listing', exists (
                 select 1 from public.rental_listings l
                  where l.status = 'active' and l.lat is not null
                    and 2 * 6371000 * asin(sqrt(
                          power(sin(radians(l.lat - p.lat::double precision) / 2), 2)
                        + cos(radians(p.lat::double precision)) * cos(radians(l.lat))
                          * power(sin(radians(l.lng - p.lng::double precision) / 2), 2))) < 1000)
             ) r
        from pts p
       where p.lat is not null and p.lng is not null
       group by p.lat, p.lng
    ) q;
$$;

revoke all on function public.demand_points(integer) from public, anon, authenticated;
grant execute on function public.demand_points(integer) to service_role;

-- The waitlist sweep reads "unnotified, near this listing".
create index if not exists parking_requests_unnotified_idx
  on public.parking_requests (created_at desc)
  where notified_at is null;

commit;
