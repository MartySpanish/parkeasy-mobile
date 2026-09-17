-- Parking at somebody's house is not a vending machine.
--
-- Today every booking is instant: the driver pays, Stripe captures, and the
-- first the host hears of a stranger arriving at their driveway is the
-- confirmation email. That is fine for a GAA club car park with 40 spaces and
-- wrong for a private drive, where the host may have a car in it, be away, or
-- simply not want that person that day. A host who cannot say no has not
-- agreed to anything.
--
-- WHAT THIS ADDS. A booking on an approval listing goes:
--
--     pending  --(card authorised)-->  awaiting_host
--       awaiting_host --(host accepts)--> paid        money captured
--       awaiting_host --(host declines)--> declined   authorisation released
--       awaiting_host --(deadline passes)--> expired  authorisation released
--
-- THE MONEY. The card is AUTHORISED at checkout and captured only when the
-- host accepts (Stripe capture_method: 'manual'). Nothing is taken for a
-- booking that is refused — no charge, no refund, no 5-day wait for the money
-- to come back.
--
-- Authorisations expire after about a week, which sounds like it rules this
-- out for a booking three weeks ahead. It does not: the authorisation only has
-- to survive until the HOST ANSWERS, which is capped at 24 hours below, not
-- until the parking date. Capture happens on acceptance and the booking then
-- behaves like any other.
--
-- WHY THE FLAG IS COPIED ONTO THE BOOKING. requires_host_approval is snapshot
-- from the listing at checkout, the same way payout_mode and
-- operator_share_pence already are. A host turning approval off next month
-- must not retroactively change the rules of a booking already taken, and a
-- host turning it ON must not strand a booking that was sold as instant.

begin;

-- ── The listing side ────────────────────────────────────────────────────────
alter table public.rental_listings
  add column if not exists requires_host_approval boolean not null default false;

comment on column public.rental_listings.requires_host_approval is
  'Booking requests must be accepted by the host before the card is captured. '
  'Defaults on for driveways — someone''s house — and off for car parks.';

-- Driveways are the ones that are somebody's home. Existing rows only; the
-- default above is false, and the app sets it explicitly on new listings so a
-- car park is never silently switched to request-only.
update public.rental_listings
   set requires_host_approval = true
 where space_type = 'driveway';

-- ── The booking side ────────────────────────────────────────────────────────
alter table public.bookings
  add column if not exists requires_host_approval boolean not null default false,
  -- When the request lapses if the host has not answered. Set at checkout to
  -- the SOONER of 24 hours and the start time: a request for a space in three
  -- hours cannot sit for a day, and a driver must never be left holding an
  -- authorisation for a slot that has already begun.
  add column if not exists approval_deadline  timestamptz,
  add column if not exists host_responded_at  timestamptz,
  add column if not exists host_decline_reason text;

-- THE INVARIANT. An approval booking cannot be paid unless the host answered.
--
-- This is the whole feature expressed as a constraint. Every other guard —
-- the endpoint, the webhook, the UI — is code that can be bypassed by the next
-- person to touch it; this one is enforced by Postgres on every write,
-- including a hand-run UPDATE in the dashboard at midnight.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'bookings_host_approval_chk') then
    alter table public.bookings add constraint bookings_host_approval_chk
      check (not (requires_host_approval and status = 'paid' and host_responded_at is null));
  end if;
end $$;

-- The statuses this table is allowed to hold. Added now because three new ones
-- arrive with this change and an unconstrained text column is how a typo
-- becomes a booking nobody can find.
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'bookings_status_chk') then
    alter table public.bookings add constraint bookings_status_chk
      -- Exactly the four the code writes today plus the three this change
      -- adds. Not 'refunded': a refund is recorded in refund_status, and
      -- listing a value nothing writes invites somebody to start writing it.
      check (status in ('pending', 'awaiting_host', 'paid',
                        'declined', 'expired', 'failed', 'cancelled'));
  end if;
end $$;

-- The host's queue, and the expiry sweep, are both "requests still waiting".
create index if not exists bookings_awaiting_host_idx
  on public.bookings (approval_deadline)
  where status = 'awaiting_host';

commit;
