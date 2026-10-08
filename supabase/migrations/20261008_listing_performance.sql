-- Which spaces are earning, which cannot be booked, and why.
--
-- WHAT WAS MISSING. partner_stats(), qr_scan_stats(), app_events_summary(),
-- hotspot_conversion_stats() and demand_points() all exist. There is nothing
-- for the marketplace itself: utilisation, bookings per space, revenue per
-- space, and host activation all had to be worked out by hand-querying.
--
-- The audit found three facts by hand that this function now surfaces:
--   · 6 listings, 3 of them still drafts
--   · Belfast Royal Academy is status 'active' but its availability window
--     closed on 18 August, so it cannot take a booking and nothing said so
--   · £46.00 of gross bookings produced £34.00 to hosts and £12.00 to ParkEasy
--
-- NO UTILISATION PERCENTAGE ON THIN DATA. The honest ratio across two lifetime
-- bookings is about 0.03%, which tells nobody anything and reads as a broken
-- dashboard. So occupancy_pct is NULL until a listing has had a bookable
-- window at all, and the raw numerator and denominator (space_days_sold,
-- space_days_available) are returned beside it so the figure can always be
-- checked rather than trusted.
--
-- BLOCKED_REASON DELIBERATELY DOES NOT REIMPLEMENT THE PUBLISH GATE. The gate
-- lives in src/data/publishGateCore.js and is shared by App.jsx and
-- api/publish-listing.js precisely because it had once been duplicated and the
-- two copies diverged — one was relaxed and the other was not, and the bug
-- lived for a release. Copying its eleven rules into SQL would make a third
-- copy. This reports only the two unambiguous facts the gate does not own:
-- the row is not active, or its availability window has closed. Everything
-- else is returned as raw columns for a human to read.
begin;

create or replace function public.listing_performance(p_days integer default 365)
returns table (
  listing_id            uuid,
  title                 text,
  status                text,
  host_type             text,
  spaces                integer,
  price_per_hour        numeric,
  price_per_day         numeric,
  min_notice_hours      integer,
  available_from        date,
  available_until       date,
  photo_count           integer,
  bookable_now          boolean,
  blocked_reason        text,
  paid_bookings         integer,
  cancelled_bookings    integer,
  gross_pence           bigint,
  host_pence            bigint,
  platform_pence        bigint,
  first_booking_at      timestamptz,
  last_booking_at       timestamptz,
  space_days_sold       integer,
  space_days_available  integer,
  occupancy_pct         numeric,
  revenue_per_space_pence bigint
)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  with win as (
    select greatest(1, least(coalesce(p_days, 365), 3650)) as days
  ),
  -- Bookings in the window. 'paid' is the only status that means money moved:
  -- the seven rows dated 4 August carry no payment intent and are test
  -- traffic, which is why they are counted separately rather than ignored.
  b as (
    select
      bk.listing_id,
      count(*) filter (where bk.status = 'paid')                      as paid_bookings,
      count(*) filter (where bk.status = 'cancelled')                 as cancelled_bookings,
      coalesce(sum(bk.amount_total_pence)     filter (where bk.status = 'paid'), 0) as gross_pence,
      coalesce(sum(bk.application_fee_pence)  filter (where bk.status = 'paid'), 0) as platform_pence,
      min(bk.created_at) filter (where bk.status = 'paid')            as first_booking_at,
      max(bk.created_at) filter (where bk.status = 'paid')            as last_booking_at,
      -- One booking of N hours on a day-priced site is N days; an hourly
      -- booking is a fraction of one day and rounds up to 1, because half a
      -- day sold is still a day the space was not free to sell twice.
      coalesce(sum(
        case when bk.status <> 'paid' then 0
             when l.price_per_day is not null and l.price_per_hour is null
               then greatest(1, coalesce(bk.duration_hours, 1))
             else 1
        end), 0)::integer as space_days_sold
    from public.bookings bk
    join public.rental_listings l on l.id = bk.listing_id
    cross join win
    where bk.created_at > now() - make_interval(days => win.days)
    group by bk.listing_id
  )
  select
    l.id,
    l.title,
    l.status,
    l.host_type,
    l.spaces,
    l.price_per_hour,
    l.price_per_day,
    l.min_notice_hours,
    l.available_from,
    l.available_until,
    coalesce(array_length(l.photos, 1), 0)::integer as photo_count,
    -- Bookable means a driver could complete checkout today, which is a
    -- narrower question than "is the row active".
    (l.status = 'active'
      and (l.available_until is null or l.available_until >= current_date)
      and (l.available_from  is null or l.available_from  <= current_date)
      and (coalesce(l.price_per_hour, 0) > 0 or coalesce(l.price_per_day, 0) > 0)
    ) as bookable_now,
    case
      when l.status <> 'active' then l.status
      when l.available_until is not null and l.available_until < current_date
        then 'availability window closed ' || to_char(l.available_until, 'DD Mon YYYY')
      when l.available_from is not null and l.available_from > current_date
        then 'not available until ' || to_char(l.available_from, 'DD Mon YYYY')
      when coalesce(l.price_per_hour, 0) <= 0 and coalesce(l.price_per_day, 0) <= 0
        then 'no price set'
      else null
    end as blocked_reason,
    coalesce(b.paid_bookings, 0)::integer,
    coalesce(b.cancelled_bookings, 0)::integer,
    coalesce(b.gross_pence, 0)::bigint,
    -- What the host actually received: the driver's total less our cut. Taken
    -- as a subtraction rather than a re-derived percentage so it can never
    -- disagree with what Stripe transferred.
    (coalesce(b.gross_pence, 0) - coalesce(b.platform_pence, 0))::bigint as host_pence,
    coalesce(b.platform_pence, 0)::bigint,
    b.first_booking_at,
    b.last_booking_at,
    coalesce(b.space_days_sold, 0)::integer,
    -- Capacity: spaces x the days the listing was open for business inside the
    -- window. Clamped at the window and at today, because tomorrow is not
    -- capacity that went unsold.
    (greatest(0,
      least(coalesce(l.available_until, current_date), current_date)
      - greatest(coalesce(l.available_from, (now() - make_interval(days => (select days from win)))::date),
                 (now() - make_interval(days => (select days from win)))::date)
      + 1
    ) * greatest(coalesce(l.spaces, 1), 1))::integer as space_days_available,
    case
      when l.status <> 'active' then null
      when (greatest(0,
        least(coalesce(l.available_until, current_date), current_date)
        - greatest(coalesce(l.available_from, (now() - make_interval(days => (select days from win)))::date),
                   (now() - make_interval(days => (select days from win)))::date)
        + 1
      ) * greatest(coalesce(l.spaces, 1), 1)) <= 0 then null
      else round(
        (coalesce(b.space_days_sold, 0)::numeric * 100)
        / (greatest(0,
            least(coalesce(l.available_until, current_date), current_date)
            - greatest(coalesce(l.available_from, (now() - make_interval(days => (select days from win)))::date),
                       (now() - make_interval(days => (select days from win)))::date)
            + 1
          ) * greatest(coalesce(l.spaces, 1), 1)), 2)
    end as occupancy_pct,
    (coalesce(b.gross_pence, 0) / greatest(coalesce(l.spaces, 1), 1))::bigint as revenue_per_space_pence
  from public.rental_listings l
  left join b on b.listing_id = l.id
  order by coalesce(b.gross_pence, 0) desc, l.created_at;
$$;

-- service_role ONLY. This is the whole book of business: every host's revenue,
-- every price, and which sites are failing. partner_stats() draws the same
-- line, and partner_stats_for_token() exists because ONE partner seeing their
-- own numbers is a different question from anybody seeing everybody's. There
-- is no equivalent token here yet, and inventing one before a host asks for it
-- would be building a surface nobody requested.
revoke all on function public.listing_performance(integer) from public;
grant execute on function public.listing_performance(integer) to service_role;

commit;
