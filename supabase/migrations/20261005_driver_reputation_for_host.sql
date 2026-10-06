-- Let a host see the reputation of the driver who booked their space.
--
-- The two-way rating system has been collecting host→driver ratings since
-- 27 July and NOBODY HAS EVER BEEN ABLE TO READ THEM. The policy on
-- driver_profiles is "own driver profile readable" — auth.uid() = user_id — so
-- the only person who can see a driver's score is that driver. The migration
-- that built it said so, and said what was meant to happen next:
--
--   host_to_driver → aggregated onto the driver, shown only to that driver
--                    (and later as an input to a host-side risk flag)
--
-- This is that "later". Half a trust system is being gathered and binned, and
-- the half that is missing is the half that helps supply: a parish treasurer's
-- actual question is not what the space earns, it is WHO DRIVES THROUGH OUR
-- GATE. ParkEasy has the answer and does not show it.
--
-- WHAT A HOST MAY SEE, AND WHY IT IS THIS AND NOT MORE.
--
-- An average, a count, and how many stays the driver has completed. No name,
-- no email, no review text, no which-host-said-what, and nothing about
-- bookings at anybody else's site. A host needs a signal to decide whether to
-- open a gate; they do not need another host's prose about a named individual,
-- and routing free text about a real person between strangers is a different
-- product with a different duty of care.
--
-- ONLY FOR THEIR OWN BOOKINGS. The function takes booking ids and silently
-- drops every one whose host_id is not the caller. It is not a lookup — you
-- cannot ask it about a driver, only about a car that is booked into your own
-- car park.
--
-- A FLOOR OF TWO RATINGS, for the same reason demand suppression has one: a
-- single rating is one identifiable host's private opinion of a named person,
-- and relaying it is not a reputation, it is gossip with a star on it. Below
-- the floor the host gets the stay count and an honest "new driver" instead,
-- which is a true and useful thing to say.
--
-- NOTE ON WHAT THIS WILL SHOW TODAY: there are 0 host→driver ratings and 2
-- paid bookings in the whole database, so every arrival will read "new driver"
-- until bookings and ratings actually happen. That is the correct output, not
-- a broken one — which is exactly why this was safe to ship now and the
-- demand-estimate half of the same request was not.

begin;

-- The floor, as its own function so a test can read it rather than hardcode it.
create or replace function public.driver_rating_floor() returns integer
language sql immutable as $$ select 2 $$;

create or replace function public.driver_reputation(p_booking_ids uuid[])
returns table (
  booking_id uuid,
  stars      numeric,   -- null below the floor
  ratings    integer,
  stays      integer,   -- completed bookings, the "trips" signal
  newcomer   boolean
)
language sql
security definer
set search_path = public, pg_temp
stable
as $$
  select
    b.id as booking_id,
    case when coalesce(dp.ratings_count, 0) >= public.driver_rating_floor()
         then dp.average_rating end as stars,
    coalesce(dp.ratings_count, 0)::integer as ratings,
    (select count(*) from public.bookings cb
      where cb.driver_id = b.driver_id and cb.status = 'completed')::integer as stays,
    coalesce(dp.ratings_count, 0) < public.driver_rating_floor() as newcomer
  from public.bookings b
  left join public.driver_profiles dp on dp.user_id = b.driver_id
  -- THE WHOLE ACCESS RULE. A caller sees a row only for a booking at their own
  -- site. No host_id match, no row — not an error, just nothing.
  where b.id = any(coalesce(p_booking_ids, '{}'::uuid[]))
    and b.host_id = auth.uid()
    and b.driver_id is not null;
$$;

revoke all on function public.driver_reputation(uuid[]) from public;
-- authenticated only: a host is signed in by definition, and anon has no
-- auth.uid() to match a host_id against, so this would return nothing for them
-- anyway. Being explicit beats relying on that.
grant execute on function public.driver_reputation(uuid[]) to authenticated, service_role;
revoke all on function public.driver_rating_floor() from public;
grant execute on function public.driver_rating_floor() to authenticated, service_role;

comment on function public.driver_reputation(uuid[]) is
  'Driver reputation for the caller''s OWN bookings, as aggregates only — no '
  'name, email, review text or other sites'' history. Rows for bookings the '
  'caller does not host are dropped silently. Stars suppressed below '
  'driver_rating_floor(), because one rating is one host''s opinion of a named '
  'person rather than a reputation.';

commit;
