-- Which hotspots actually produce bookings.
--
-- bookings.from_hotspot is a BOOLEAN. It records that a booking started at a
-- free spot and nothing else, so the one question worth asking — which gems
-- send people to a paid space, and which just get looked at — has been
-- unanswerable. A percentage across the whole network tells you the funnel
-- works; it does not tell you that Ormeau Embankment sends four bookings a
-- month and Cave Hill sends none.
--
-- from_hotspot_spot_id fixes that. Text, in the same shape
-- spot_occupancy.spot_id already uses — a gem's legacy_id ('66') or
-- 'rental-<uuid>' — so it joins to hidden_gems and to the occupancy history
-- without a new convention to remember.
--
-- NOT A FOREIGN KEY, deliberately. The id can point at a bundled spot that has
-- no row in hidden_gems at all (a third of the free spots are not gems), and a
-- gem can be retired while a booking it produced still stands. A constraint
-- here would either reject real bookings or delete real money.

begin;

alter table public.bookings
  add column if not exists from_hotspot_spot_id text;

comment on column public.bookings.from_hotspot_spot_id is
  'Which free spot sent this booking. Same text shape as '
  'spot_occupancy.spot_id: a gem legacy_id, or rental-<uuid>. Null when the '
  'booking did not come from a hotspot, or came from one before this column '
  'existed.';

-- The admin screen groups by this, and it is sparse — most bookings are null.
create index if not exists bookings_from_hotspot_spot_idx
  on public.bookings (from_hotspot_spot_id)
  where from_hotspot_spot_id is not null;

-- ── Per-hotspot conversion ──────────────────────────────────────────────────
--
-- Three numbers per spot, from two sources, and the split matters:
--
--   taps     app_events 'hotspot_to_booking_tap' — somebody tapped through to
--            the paid space. Client-side, so it can be lost.
--   bookings bookings.from_hotspot_spot_id where the booking was PAID. Written
--            server-side from checkout metadata, so it is the authoritative
--            one — a client event after a Stripe redirect is lost every time
--            somebody closes the receipt tab, which is exactly when a booking
--            is most complete.
--   gross    what those bookings were worth, in pence.
--
-- A spot with taps and no bookings is the interesting row: the card is being
-- read and the paid space is not being bought. That is either the wrong
-- alternative or the wrong price, and it is invisible without this.
create or replace function public.hotspot_conversion_stats(p_days integer default 90)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  with win as (select greatest(1, least(p_days, 365)) as d),
  taps as (
    select coalesce(e.props ->> 'spot', 'unknown') as spot_id,
           count(*) as taps,
           count(distinct e.session_id) as tap_sessions
      from public.app_events e, win
     where e.event_name = 'hotspot_to_booking_tap'
       and e.created_at > now() - make_interval(days => win.d)
     group by 1
  ),
  booked as (
    select b.from_hotspot_spot_id as spot_id,
           count(*) as bookings,
           sum(b.amount_total_pence) as gross_pence
      from public.bookings b, win
     where b.from_hotspot_spot_id is not null
       and b.status = 'paid'
       and b.created_at > now() - make_interval(days => win.d)
     group by 1
  )
  -- FULL join: a spot with taps and no bookings matters as much as the
  -- reverse, and either inner join would hide one of them.
  select coalesce(jsonb_agg(r order by (r->>'bookings')::int desc, (r->>'taps')::int desc), '[]'::jsonb)
    from (
      select jsonb_build_object(
               'spot_id', coalesce(t.spot_id, k.spot_id),
               -- Named where we can. A bundled free spot has no gem row, so
               -- the id is shown rather than a blank.
               'name', coalesce(g.name, coalesce(t.spot_id, k.spot_id)),
               'town', g.town,
               'is_gem', (g.id is not null),
               'taps', coalesce(t.taps, 0),
               'tap_sessions', coalesce(t.tap_sessions, 0),
               'bookings', coalesce(k.bookings, 0),
               'gross_pence', coalesce(k.gross_pence, 0)
             ) r
        from taps t
        full join booked k on k.spot_id = t.spot_id
        left join public.hidden_gems g
               on g.legacy_id = coalesce(t.spot_id, k.spot_id)
    ) q;
$$;

revoke all on function public.hotspot_conversion_stats(integer) from public, anon, authenticated;
grant execute on function public.hotspot_conversion_stats(integer) to service_role;

commit;
