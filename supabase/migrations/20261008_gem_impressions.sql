-- The locked-gem funnel could never show a drop, because its first two steps
-- were the same tap.
--
-- WHAT THE DASHBOARD SAYS. The admin "Locked gem -> Premium" funnel reads:
--
--     Saw a locked gem        gem_locked_view
--     Opened the paywall      premium_paywall_view
--     Paid                    premium_paid
--
-- WHAT THE CODE DOES. In src/App.jsx, all three locked surfaces are a single
-- button:
--
--     onClick={() => { track('gem_locked_view', { surface: 'card' }); onUpgrade(); }}
--
-- `onUpgrade()` opens the pricing modal, which fires premium_paywall_view. So
-- gem_locked_view and premium_paywall_view fire on the SAME TAP, one after the
-- other. The first step of the funnel is not an impression at all — it is the
-- click that produced the second step.
--
-- WHY THAT MATTERS RIGHT NOW. The paywall was opened 3 times in three weeks,
-- and the question on the table is whether that is a PRICE problem or an
-- EXPOSURE problem — whether anybody is reaching the locked gems at all. The
-- one funnel that should answer it is structurally incapable of doing so: it
-- shows 3 -> 3 -> 0 and a 100% step-one conversion by construction, and the
-- number actually wanted (how many people saw a locked gem and did not tap)
-- was never collected anywhere.
--
-- NAMED FOR EXACTLY WHAT IT MEASURES. 'gem_locked_rendered', not
-- 'gem_locked_seen' or '..._impression'. The client fires it once per session
-- when locked gems are painted into the results list, which is not the same as
-- the driver having scrolled to one — a card below the fold is rendered and
-- unseen. Measuring "on the page" is enough to answer the question in front of
-- us (3 means nobody is reaching the list; 400 means the offer is the problem),
-- and a name that claimed more than that would be the same class of error as
-- the one this migration exists to fix.
--
-- THE CLIENT-SIDE ALLOWLIST IN src/analytics.js MUST MATCH THIS ONE. That file
-- says so: "Both lists must be changed together — the migration is the one
-- that decides." log_app_event() returns false for an unknown name, so until
-- this is applied the event is refused and nothing is recorded.
--
-- Both functions below are reproduced from their current definitions
-- (20260902_app_events_ingest.sql and 20260925_booking_paid_authoritative.sql)
-- with one line added to each, because the allowlist is a local constant inside
-- the function body and there is nothing smaller to replace.
begin;

create or replace function public.log_app_event(
  p_event_name  text,
  p_session_id  uuid,
  p_props       jsonb   default '{}'::jsonb,
  p_path        text    default null,
  p_town        text    default null,
  p_listing_id  uuid    default null,
  p_partner_id  uuid    default null,
  p_value_pence integer default null
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  allowed constant text[] := array[
    'search', 'search_no_results', 'map_move',
    'gem_view', 'gem_locked_view', 'gem_locked_rendered',
    'listing_view', 'booking_start', 'booking_paid', 'booking_abandoned',
    'heading_tap', 'parked_tap', 'spot_taken_tap',
    'partner_impression', 'partner_click',
    'premium_paywall_view', 'premium_paid',
    'submit_spot_start', 'submit_spot_done',
    'qr_landing', 'share_tap',
    'hotspot_to_booking_tap'
  ];
  recent integer;
  clean  jsonb;
begin
  -- Unknown name: refuse. Returning false rather than raising keeps a bad
  -- client from seeing a stack trace, and keeps the caller's catch block quiet.
  if p_event_name is null or not (p_event_name = any(allowed)) then
    return false;
  end if;

  if p_session_id is null then
    return false;
  end if;

  select count(*) into recent
    from public.app_events
   where session_id = p_session_id
     and created_at > now() - interval '1 minute';

  if recent >= 60 then
    return false;
  end if;

  -- Shape props. Anything that is not an object becomes {}. Keys past the
  -- twentieth are dropped and string values are truncated; a metric payload
  -- has no business being longer than this.
  if p_props is null or jsonb_typeof(p_props) <> 'object' then
    clean := '{}'::jsonb;
  else
    select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) into clean
      from (
        select key as k,
               case when jsonb_typeof(value) = 'string'
                    then to_jsonb(left(value #>> '{}', 200))
                    else value end as v
          from jsonb_each(p_props)
         order by key
         limit 20
      ) capped;
  end if;

  insert into public.app_events
    (event_name, session_id, user_id, path, town, listing_id, partner_id, value_pence, props)
  values
    (p_event_name, p_session_id, auth.uid(), left(p_path, 300), left(p_town, 120),
     p_listing_id, p_partner_id, p_value_pence, clean);

  return true;
end $$;

revoke all on function public.log_app_event(text, uuid, jsonb, text, text, uuid, uuid, integer) from public;
grant execute on function public.log_app_event(text, uuid, jsonb, text, text, uuid, uuid, integer)
  to anon, authenticated;

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
      -- THE STEP THAT WAS MISSING. See the header of
      -- 20261008_gem_impressions.sql: the two steps below both fire on the
      -- same tap, so this funnel could never show a drop between them.
      'gem_locked_rendered',  (select count(distinct session_id) from window_events where event_name = 'gem_locked_rendered'),
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
