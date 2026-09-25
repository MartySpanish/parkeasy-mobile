-- The bottom of the funnel, counted from the side that cannot be closed.
--
-- WHAT IS WRONG TODAY. 'booking_paid' is fired in one place: src/App.jsx, when
-- the driver lands back on parkeasy.uk from Stripe with ?booking=success. That
-- event only happens if the browser comes back. Somebody who pays and then
-- closes the receipt tab, loses signal in a car park, or gets their phone taken
-- over by a call has paid — and the funnel never hears about it.
--
-- So the ONE number that decides whether any of this is working is measured on
-- the least reliable leg of the whole journey. The app already knows this: the
-- admin dashboard carries a comment saying a client event after a Stripe
-- redirect is "lost every time somebody closes the receipt tab, which is
-- exactly when a booking is most complete" — and it fixed that for the
-- hotspot funnel only, by reading bookings.from_hotspot server-side instead.
-- This does the same for the main funnel.
--
-- THE STRIPE WEBHOOK IS THE RELIABLE SIDE. ("Webhook" = Stripe's servers call
-- ours directly to say what happened, instead of relying on the customer's
-- browser to carry the news. It retries for days if we are down.) The webhook
-- already marks the booking paid; it just never told the funnel.
--
-- WHY THIS IS NOT A DOUBLE COUNT. The driver's browsing session id is carried
-- into Stripe's metadata when the checkout is created and comes back on the
-- webhook, so the server logs the event AS THAT SESSION. When the browser does
-- come back it logs the same session again, and app_events_summary counts
-- `count(distinct session_id)` — one session, one booking, whether the tab
-- survived or not. The unique index below then stops even the raw row count
-- drifting, which matters because "total booking_completed" is a number
-- somebody reads off a dashboard and believes.

begin;

--------------------------------------------------------------------------------
-- 1. One paid-booking event per Stripe checkout, ever
--------------------------------------------------------------------------------
-- Stripe retries a webhook until it gets a 2xx, and it is explicitly at-least
-- once: the same checkout.session.completed can arrive three times. Without
-- this index that is three bookings on the dashboard.
--
-- Partial, so it costs nothing for the other event names and constrains only
-- the rows that carry a Stripe checkout id.
create unique index if not exists app_events_booking_paid_once
  on public.app_events ((props ->> 'stripe_session'))
  where event_name = 'booking_paid' and props ? 'stripe_session';

--------------------------------------------------------------------------------
-- 2. Logging it
--------------------------------------------------------------------------------
-- service_role only. This writes the number the business is judged on, so it is
-- reachable from the webhook and from nowhere else — a driver who could call it
-- could invent paid bookings.
--
-- Returns true only when it actually wrote a row, so the webhook can tell a
-- first delivery from a retry.
create or replace function public.log_booking_paid(
  p_stripe_session text,
  p_session_id     text default null,
  p_listing_id     uuid default null,
  p_value_pence    integer default null,
  p_user_id        uuid default null
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_sid uuid;
  v_hit integer;
begin
  if p_stripe_session is null or trim(p_stripe_session) = '' then return false; end if;

  -- The browsing session, when the client sent one. It is a uuid in
  -- app_events and arrives from Stripe metadata as text, so a malformed one is
  -- dropped rather than raising: a booking event with no session is still worth
  -- having, and an exception here would fail the webhook and make Stripe retry
  -- a delivery that has already done its real work.
  begin
    v_sid := nullif(trim(coalesce(p_session_id, '')), '')::uuid;
  exception when others then
    v_sid := null;
  end;

  insert into public.app_events
    (event_name, session_id, user_id, listing_id, value_pence, props)
  values
    ('booking_paid', v_sid, p_user_id, p_listing_id, p_value_pence,
     jsonb_build_object('stripe_session', trim(p_stripe_session), 'source', 'webhook'))
  on conflict do nothing;

  get diagnostics v_hit = row_count;
  return v_hit > 0;
end $$;

revoke all on function public.log_booking_paid(text, text, uuid, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.log_booking_paid(text, text, uuid, integer, uuid)
  to service_role;

--------------------------------------------------------------------------------
-- 3. Who registered and never booked
--------------------------------------------------------------------------------
-- The re-engagement list. 477 accounts, almost no completed bookings — these
-- are the people that gap is made of.
--
-- "NEVER BOOKED" MEANS NEVER PAID, not "has no booking row". A driver whose
-- payment failed, or who abandoned checkout, has a bookings row with status
-- 'pending' or 'failed' and has never parked with us — they belong on this
-- list, and a naive `not exists (select 1 from bookings)` would quietly drop
-- them. It is also matched on EMAIL as well as driver_id, because a guest
-- checkout records driver_email with no account attached, and somebody who
-- booked as a guest and signed up later is not somebody to win back.
--
-- service_role only: this is every registered email in one query, which is the
-- single most sensitive read in the database.
create or replace view public.users_never_booked
with (security_invoker = false) as
select
  u.id            as user_id,
  u.email,
  u.created_at    as registered_at,
  -- How long they have been signed up without ever parking. The number that
  -- decides who is worth an email and what it should say: a week-old account
  -- is a nudge, a six-month-old one is a different letter.
  (current_date - u.created_at::date) as days_since_signup
from auth.users u
where u.email is not null
  and not exists (
    select 1 from public.bookings b
     where b.status = 'paid'
       and (b.driver_id = u.id or lower(b.driver_email) = lower(u.email))
  )
order by u.created_at desc;

revoke all on public.users_never_booked from anon, authenticated;
grant select on public.users_never_booked to service_role;

comment on view public.users_never_booked is
  'Registered accounts with no PAID booking, for re-engagement. Counts a '
  'failed or abandoned checkout as never booked, and matches guest bookings '
  'on email as well as driver_id. service_role only — it is every registered '
  'email in one query.';

--------------------------------------------------------------------------------
-- 4. Making the funnel count it
--------------------------------------------------------------------------------
-- WITHOUT THIS, EVERYTHING ABOVE CHANGES NOTHING ANYBODY LOOKS AT.
--
-- app_events_summary counts each funnel step as count(distinct session_id),
-- which is right — one person opening three listings is one person, and
-- counting events would flatter every conversion rate. But count(distinct)
-- SKIPS NULLS, and a webhook-logged booking has no session whenever the client
-- did not send one: an older app version, a browser with localStorage blocked,
-- or a guest checkout begun somewhere the id never reached. Those are real paid
-- bookings, sitting in app_events, invisible to the only screen that matters.
--
-- So booking_paid is counted as: one per browsing session, PLUS one for each
-- paid booking that has no session but does have a Stripe checkout id — which
-- is unique per payment and already deduped by the index above. Every real
-- booking counts once and no booking counts twice.
--
-- The other steps stay on distinct sessions: they only ever happen in a
-- browser, so a null session there is a bug rather than a booking.
create or replace function public.app_events_summary(p_days integer default 30)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  with window_events as (
    select * from public.app_events
     where created_at > now() - make_interval(days => greatest(1, least(p_days, 365))))
  select jsonb_build_object(
    'days', greatest(1, least(p_days, 365)),
    'generated_at', now(),

    'daily', coalesce((
      select jsonb_agg(r order by r->>'day' desc, r->>'event_name')
        from (select jsonb_build_object(
                'day', (created_at at time zone 'Europe/London')::date,
                'event_name', event_name,
                'n', count(*)) r
                from window_events
               group by (created_at at time zone 'Europe/London')::date, event_name) d), '[]'::jsonb),

    'premium_funnel', jsonb_build_object(
      'gem_locked_view',      (select count(distinct session_id) from window_events where event_name = 'gem_locked_view'),
      'premium_paywall_view', (select count(distinct session_id) from window_events where event_name = 'premium_paywall_view'),
      'premium_paid',         (select count(distinct session_id) from window_events where event_name = 'premium_paid')),

    'booking_funnel', jsonb_build_object(
      'listing_view',  (select count(distinct session_id) from window_events where event_name = 'listing_view'),
      'booking_start', (select count(distinct session_id) from window_events where event_name = 'booking_start'),
      'booking_paid',  (select count(*) from (
                          select distinct
                            coalesce(session_id::text, 'stripe:' || (props ->> 'stripe_session'))
                            from window_events
                           where event_name = 'booking_paid'
                             and (session_id is not null or props ? 'stripe_session')) b)),

    'no_results', coalesce((
      select jsonb_agg(r order by (r->>'n')::int desc)
        from (select jsonb_build_object(
                'query', coalesce(props->>'query', '(none)'),
                'town', coalesce(town, '(none)'),
                'n', count(*),
                'sessions', count(distinct session_id)) r
                from window_events
               where event_name = 'search_no_results'
               group by props->>'query', town
               order by count(*) desc
               limit 100) q), '[]'::jsonb)
  );
$$;

revoke all on function public.app_events_summary(integer) from public, anon, authenticated;
grant execute on function public.app_events_summary(integer) to service_role;

commit;
