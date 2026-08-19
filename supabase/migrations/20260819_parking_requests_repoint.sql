-- The founder dashboard was counting a table nothing wrote to. APPLIED 19 Aug 2026.
--
-- ── THE BUG ───────────────────────────────────────────────────────────────
-- founder_dashboard reported demand_total and demand_7d from the parking_demand
-- TABLE. The app has only ever inserted into parking_requests — see the
-- RequestParking card in App.jsx. So both figures counted a table with no
-- writer and would have read 0 for ever, including after 20260819_parking_requests.sql
-- applied perfectly.
--
-- This is the kind of bug that does not announce itself. A brand new demand
-- feature reading 0 looks exactly like a brand new demand feature nobody has
-- used yet, and the number only becomes suspicious after enough weeks of
-- silence that the feature looks like the failure instead of the wiring.
--
-- Neither founder_dashboard nor the parking_demand table was ever in this
-- repo — both were created directly against the database, which is why
-- grepping the migrations for the name found nothing and the collision only
-- surfaced when Postgres refused the drop.
--
-- ── ORDER MATTERS ─────────────────────────────────────────────────────────
-- founder_dashboard depended on the parking_demand table, so the table could
-- not be dropped until the dashboard stopped reading it. Hence: replace the
-- dashboard first, then drop, then let the view take the name. And it had to
-- be a drop rather than a CASCADE-and-rebuild — the aggregate view has no
-- created_at column (it has first_asked and last_asked), so the dashboard's
-- 7-day filter could not have been rebuilt against it.
--
-- The column list, types and order are untouched, so this is a genuine replace
-- and the existing grants survive: service_role only, no anon, no authenticated.

create or replace view public.founder_dashboard as
 WITH l AS (
         SELECT count(*) AS listings_total,
            count(*) FILTER (WHERE rental_listings.status = 'active'::text) AS listings_live,
            count(*) FILTER (WHERE rental_listings.status = 'draft'::text) AS listings_draft,
            count(*) FILTER (WHERE rental_listings.status = 'active'::text AND cardinality(COALESCE(rental_listings.photos, '{}'::text[])) = 0) AS listings_live_without_photos
           FROM rental_listings
        ), b AS (
         SELECT count(*) AS bookings_total,
            count(*) FILTER (WHERE bookings.status = 'paid'::text) AS bookings_paid,
            COALESCE(sum(bookings.amount_total_pence) FILTER (WHERE bookings.status = 'paid'::text), 0::bigint) AS gross_pence,
            COALESCE(sum(bookings.application_fee_pence + bookings.service_fee_pence) FILTER (WHERE bookings.status = 'paid'::text), 0::bigint) AS take_pence,
            count(*) FILTER (WHERE bookings.created_at > (now() - '7 days'::interval)) AS bookings_7d
           FROM bookings
        ), h AS (
         SELECT count(*) AS hosts_total,
            count(*) FILTER (WHERE host_accounts.transfers_active) AS hosts_payable
           FROM host_accounts
        ), a AS (
         SELECT count(*) FILTER (WHERE partner_events.event_type = 'impression'::text) AS ad_impressions,
            count(*) FILTER (WHERE partner_events.event_type = 'click'::text) AS ad_clicks,
            count(*) FILTER (WHERE partner_events.event_type = 'impression'::text AND partner_events.created_at > (now() - '7 days'::interval)) AS ad_impressions_7d
           FROM partner_events
        ), p AS (
         SELECT count(*) FILTER (WHERE partners.active) AS advertisers_live,
            count(*) FILTER (WHERE partners.active AND partners.renewal_due_at < (now() + '14 days'::interval)) AS advertisers_due_renewal
           FROM partners
        ), d AS (
         -- WAS: FROM parking_demand. That is the whole fix.
         SELECT count(*) AS demand_total,
            count(*) FILTER (WHERE parking_requests.created_at > (now() - '7 days'::interval)) AS demand_7d
           FROM parking_requests
        ), q AS (
         SELECT count(*) AS scans_total,
            count(*) FILTER (WHERE qr_scans.created_at > (now() - '7 days'::interval)) AS scans_7d
           FROM qr_scans
        )
 SELECT l.listings_live,
    l.listings_draft,
    l.listings_total,
    l.listings_live_without_photos,
    h.hosts_total,
    h.hosts_payable,
    b.bookings_paid,
    b.bookings_7d,
    round(b.gross_pence::numeric / 100.0, 2) AS bookings_gross_gbp,
    round(b.take_pence::numeric / 100.0, 2) AS parkeasy_take_gbp,
    p.advertisers_live,
    p.advertisers_due_renewal,
    a.ad_impressions,
    a.ad_clicks,
    round(100.0 * a.ad_clicks::numeric / NULLIF(a.ad_impressions, 0)::numeric, 2) AS ad_ctr_pct,
    a.ad_impressions_7d,
    d.demand_total,
    d.demand_7d,
    q.scans_total,
    q.scans_7d
   FROM l, b, h, a, p, d, q;

-- The guard is the point of this block, not the drop. An empty duplicate is
-- safe to remove; one with somebody's email in it is a lead, and losing a lead
-- to a tidy-up is worse than leaving a stray table in the schema. Verified at
-- 0 rows before running, and this re-checks at the moment of dropping rather
-- than trusting a count taken minutes earlier.
do $$
declare n bigint;
begin
  if to_regclass('public.parking_demand') is not null
     and (select relkind from pg_class where oid = 'public.parking_demand'::regclass) = 'r' then
    execute 'select count(*) from public.parking_demand' into n;
    if n > 0 then
      raise exception 'parking_demand has % row(s) — refusing to drop', n;
    end if;
    drop table public.parking_demand;
  end if;
end $$;
