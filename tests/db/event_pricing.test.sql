-- Event-day pricing: which events get suggested, and to which listings.
--
-- The suggestion is the whole feature — the table and the checkout path have
-- worked all along, nothing ever wrote a row. So these checks are about what
-- reaches the screen: the wrong event suggested is a host being asked to
-- overcharge on a quiet Tuesday, and a missed one is the money the feature
-- exists to make.
\set ON_ERROR_STOP on
set client_min_messages = notice;

create or replace function assert(p_cond boolean, p_what text)
returns void language plpgsql as $$
begin
  if p_cond then raise notice '  PASS  %', p_what;
  else raise exception 'FAIL  %', p_what;
  end if;
end $$;

create or replace function sugg(p_radius integer default 2000)
returns setof jsonb language sql as $$
  select * from jsonb_array_elements(public.event_pricing_suggestions(p_radius, 90));
$$;

--------------------------------------------------------------------------------
\echo ''
\echo '1. Which events are worth pricing up'
--------------------------------------------------------------------------------
select assert(exists (select 1 from sugg() s where s->>'event' = 'A big gig'),
  'a high-tier event near a listing is suggested');
select assert(not exists (select 1 from sugg() s where s->>'event' = 'A quiet night'),
  'a low-demand event is not — nobody pays extra for a quiet Tuesday');
select assert(not exists (select 1 from sugg() s where s->>'event' = 'A cancelled gig'),
  'a CANCELLED event is not suggested, however major it was');
select assert(not exists (select 1 from sugg() s where s->>'event' = 'Last year''s gig'),
  'a past event is not suggested');

--------------------------------------------------------------------------------
\echo ''
\echo '2. The radius, which is the whole reason this is 2km'
--------------------------------------------------------------------------------
-- The listing sits ~1.9 km from the O2: inside 2 km, outside 1.5 km. That gap
-- is exactly the live data — the nearest high/major venue to any real active
-- listing is 1,711 m and the O2 is 1,977 m — so at the brief's 1.5 km this
-- screen would always be empty.
select assert(exists (select 1 from sugg(2000) s where s->>'listing' = 'Near the arena'),
  'at 2km the nearby listing is suggested');
select assert(not exists (select 1 from sugg(1500) s where s->>'listing' = 'Near the arena'),
  'at 1500m it is not — which is why the default is 2000');
select assert(not exists (select 1 from sugg(2000) s where s->>'listing' = 'Far away'),
  'a listing in Coleraine is never suggested for a Belfast gig');

select assert((select (s->>'metres')::int from sugg() s where s->>'listing' = 'Near the arena' limit 1)
              between 1500 and 2100,
  'the distance is reported, and is the real one');

--------------------------------------------------------------------------------
\echo ''
\echo '3. What the screen needs to price the conversation'
--------------------------------------------------------------------------------
select assert((select (s->>'price_per_day_pence')::int from sugg() s limit 1) = 2000,
  'the current day price comes through in pence');
select assert((select s->>'venue' from sugg() s limit 1) = 'The O2 Belfast',
  'the venue is named');
select assert((select s->>'existing_pence' from sugg() s limit 1) is null,
  'no price is set for that date yet');

-- Once a price IS set, the suggestion says so rather than offering to
-- overwrite it silently.
-- event_id SET, deliberately. Without it there is no foreign key to cascade
-- and the delete test below asserts nothing — which is exactly what happened
-- the first time: the "delete does not remove the price" mutation passed
-- because the row was never linked to the event at all.
insert into public.listing_price_overrides (listing_id, override_date, price_pence, label, event_id)
select '22222222-0000-0000-0000-000000000001',
       (starts_at at time zone 'Europe/London')::date, 3500, 'Event pricing — A big gig', id
  from public.events where name = 'A big gig';

select assert((select event_id from public.listing_price_overrides where price_pence = 3500) is not null,
  'the override is linked to its event, so the delete test below means something');

select assert((select (s->>'existing_pence')::int from sugg() s where s->>'event' = 'A big gig') = 3500,
  'an existing override is reported back');
select assert((select s->>'existing_label' from sugg() s where s->>'event' = 'A big gig')
              = 'Event pricing — A big gig',
  'and so is what the driver will be told');

--------------------------------------------------------------------------------
\echo ''
\echo '4. The override survives the event being renamed or deleted'
--------------------------------------------------------------------------------
-- The label is snapshotted. What somebody was charged for cannot change after
-- the fact because a listing in the events table was edited.
update public.events set name = 'Renamed gig' where name = 'A big gig';
select assert((select label from public.listing_price_overrides where price_pence = 3500)
              = 'Event pricing — A big gig',
  'renaming the event does not rewrite what the driver was told');

delete from public.events where name = 'Renamed gig';
select assert((select count(*) from public.listing_price_overrides where price_pence = 3500) = 1,
  'deleting the event does not delete the price somebody may already have paid');
select assert((select event_id from public.listing_price_overrides where price_pence = 3500) is null,
  'the link is nulled rather than cascading the row away');

--------------------------------------------------------------------------------
\echo ''
\echo '5. Who can read it'
--------------------------------------------------------------------------------
grant usage on schema public to anon;
select assert(not has_function_privilege('anon', 'public.event_pricing_suggestions(integer,integer)', 'execute'),
  'anon cannot read the pricing plan');
select assert(has_function_privilege('service_role', 'public.event_pricing_suggestions(integer,integer)', 'execute'),
  'service_role can');

\echo ''
\echo 'event pricing: all checks passed'
