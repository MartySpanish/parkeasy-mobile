-- The numbers that sell the next card, and the one that must not leak.
--
-- partner_stats_for_token() is reachable by anon — that is the whole point, a
-- link Marty can text a barber without making him create an account. So the
-- interesting question is not whether it returns the right counts but whether
-- a token can be made to return somebody else's.
\set ON_ERROR_STOP on
set client_min_messages = notice;

create or replace function assert(p_cond boolean, p_what text)
returns void language plpgsql as $$
begin
  if p_cond then raise notice '  PASS  %', p_what;
  else raise exception 'FAIL  %', p_what;
  end if;
end $$;

insert into public.partners (slug, name, tagline, lat, lng, active, tier) values
  ('barber',  'The Barber',  'Cuts',  54.59, -5.93, true, 'featured'),
  ('rival',   'The Rival',   'Also cuts', 54.60, -5.94, true, 'sponsored'),
  ('quiet',   'Quiet Cafe',  'Coffee', 54.61, -5.95, true, 'featured');

-- The barber: 5 impressions, 2 clicks. The rival: 3 and 0. Quiet Cafe: nothing
-- at all, which is exactly the partner worth spotting.
insert into public.partner_events (partner_id, event_type)
select id, 'impression' from public.partners, generate_series(1,5) where slug='barber';
insert into public.partner_events (partner_id, event_type)
select id, 'click' from public.partners, generate_series(1,2) where slug='barber';
insert into public.partner_events (partner_id, event_type)
select id, 'impression' from public.partners, generate_series(1,3) where slug='rival';

-- One impression outside the window, to prove the window is honoured.
insert into public.partner_events (partner_id, event_type, created_at)
select id, 'impression', now() - interval '90 days' from public.partners where slug='barber';

--------------------------------------------------------------------------------
\echo ''
\echo '1. The admin view'
--------------------------------------------------------------------------------
select assert((select (r->>'impressions')::int from jsonb_array_elements(public.partner_stats(30)) r
                where r->>'slug' = 'barber') = 5,
  'the barber has 5 impressions in the window');
select assert((select (r->>'clicks')::int from jsonb_array_elements(public.partner_stats(30)) r
                where r->>'slug' = 'barber') = 2,
  'and 2 clicks');
select assert((select (r->>'impressions')::int from jsonb_array_elements(public.partner_stats(120)) r
                where r->>'slug' = 'barber') = 6,
  'widening the window picks up the older impression');

-- A partner with NO events must still appear. An inner join would hide exactly
-- the partner whose card is not working.
select assert(exists (select 1 from jsonb_array_elements(public.partner_stats(30)) r
                where r->>'slug' = 'quiet'),
  'a partner with no impressions is still listed — that is the one to look at');
select assert((select (r->>'impressions')::int from jsonb_array_elements(public.partner_stats(30)) r
                where r->>'slug' = 'quiet') = 0,
  'and shows zero rather than nothing');

select assert((select r->>'tier' from jsonb_array_elements(public.partner_stats(30)) r
                where r->>'slug' = 'rival') = 'sponsored',
  'the tier travels with the numbers, so the screen can price the conversation');

--------------------------------------------------------------------------------
\echo ''
\echo '2. The token page — and what it must not reach'
--------------------------------------------------------------------------------
grant usage on schema public to anon;

-- Grab the tokens BEFORE dropping to anon. anon cannot read partners, which is
-- the point — in real use Marty copies the token off the admin screen into a
-- URL, and the page never queries the table.
select stats_token as barber_token from public.partners where slug = 'barber' \gset
select stats_token as rival_token  from public.partners where slug = 'rival'  \gset

set role anon;

select assert((public.partner_stats_for_token(:'barber_token', 30) ->> 'impressions')::int = 5,
  'a token returns that partner''s impressions');
select assert(public.partner_stats_for_token(:'barber_token', 30) ->> 'name' = 'The Barber',
  'and names them, so the page is obviously theirs');

-- THE ONE THAT MATTERS. A token belongs to one partner and cannot be pointed
-- at another; there is no argument through which it could be.
select assert((public.partner_stats_for_token(:'rival_token', 30) ->> 'impressions')::int = 3,
  'a different token returns a different partner''s numbers, not the first one''s');
select assert(public.partner_stats_for_token(
                 '00000000-0000-0000-0000-000000000000'::uuid, 30) is null,
  'an unknown token returns nothing at all');

-- anon must not be able to read the whole book of business, by any route.
select assert(not has_function_privilege('anon', 'public.partner_stats(integer)', 'execute'),
  'anon cannot run the all-partners stats function');
select assert(not has_table_privilege('anon', 'public.partner_events', 'select'),
  'anon cannot read partner_events directly');

reset role;
select assert(has_function_privilege('service_role', 'public.partner_stats(integer)', 'execute'),
  'service_role can run the admin stats');

--------------------------------------------------------------------------------
\echo ''
\echo '3. Every partner has a token, and no two share one'
--------------------------------------------------------------------------------
select assert((select count(*) from public.partners where stats_token is null) = 0,
  'no partner is without a stats token');
select assert((select count(distinct stats_token) from public.partners)
            = (select count(*) from public.partners),
  'no two partners share a token');

\echo ''
\echo 'partner stats: all checks passed'
