-- Let a listing be sold without the host holding a Stripe Connect account.
--
-- NOT YET APPLIED to production.
--
-- THE BLOCKER THIS REMOVES. checkout/create-session.js refuses with a 409
-- unless the listing's owner has a connected account with transfers active,
-- because every booking is a destination charge: the driver pays, Stripe splits
-- it, and the host's 85% lands in their own account automatically.
--
-- That is right for a GAA club. It is the wrong shape for a commercial operator
-- with a finance department, an invoicing process and no interest in onboarding
-- to somebody else's Stripe. APCOA is the case in front of us and it will not be
-- the last: every multi-site operator works this way.
--
-- ParkEasy ALREADY has the other model and shipped it this week. Corporate
-- pooled permits collect the whole amount into ParkEasy's balance and settle
-- with the car park operator separately — see public.operator_settlements. This
-- is that arrangement, made available to an ordinary booking.
--
-- ⚠️ WHAT THIS DOES NOT DO. It does not pay the operator. Nothing does; that is
-- the entire point of the invoice model. The money lands with ParkEasy and
-- somebody has to send the operator their share. The view at the bottom is the
-- list of what is owed, and it is the only record that it is owed.
alter table public.rental_listings
  add column if not exists payout_mode text not null default 'connect'
    check (payout_mode in ('connect','invoice')),
  -- What the operator is owed, as a percent of the space price. Only meaningful
  -- in invoice mode; in connect mode Stripe already applies the 85/15 split.
  --
  -- NO DEFAULT ON PURPOSE. 85 would look like the standard host split and it is
  -- not one — an operator's share is a negotiated commercial term, and a default
  -- here would silently invent one the day somebody forgot to set it.
  add column if not exists operator_share_pct numeric(5,2)
    check (operator_share_pct is null or (operator_share_pct >= 0 and operator_share_pct <= 100));

comment on column public.rental_listings.payout_mode is
  '''connect'': destination charge, host paid automatically by Stripe — the '
  'default and right for clubs and driveways. ''invoice'': ParkEasy collects the '
  'whole amount and settles with the operator off-platform. Invoice mode needs '
  'no Connect account, and pays nobody by itself.';

-- An invoice-mode listing must say what the operator is owed. Otherwise the
-- money arrives and there is no record of whose it is.
alter table public.rental_listings
  drop constraint if exists invoice_mode_needs_share;
alter table public.rental_listings
  add constraint invoice_mode_needs_share
  check (payout_mode <> 'invoice' or operator_share_pct is not null);

-- Bookings record which model they were taken under, because it decides who is
-- owed what and a listing's mode can change afterwards.
alter table public.bookings
  add column if not exists payout_mode text not null default 'connect',
  add column if not exists operator_share_pence integer not null default 0;

comment on column public.bookings.operator_share_pence is
  'What the operator is owed for this booking, in pence. Zero under connect, '
  'where Stripe has already transferred it. Snapshotted at checkout so a later '
  'change to the listing''s share cannot rewrite what was owed on a booking '
  'already taken.';

--------------------------------------------------------------------------------
-- What ParkEasy owes, per operator per month
--------------------------------------------------------------------------------
-- The sibling of operator_settlements, which does the same job for corporate
-- permits. Deliberately the same shape and the same plainness — this is read by
-- somebody doing a bank transfer, not by a dashboard.
create or replace view public.booking_settlements
with (security_invoker = true) as
with settled as (
  select
    b.listing_id,
    date_trunc('month', b.created_at)::date as period_month,
    b.amount_total_pence,
    coalesce(b.refund_pence, 0) as refund_pence,
    -- WHAT A REFUND DOES TO THE OPERATOR'S SHARE. A refund comes out of the
    -- space price and any overnight fee; the driver service fee is ours and is
    -- never handed back. So the operator's share drops by the same proportion
    -- of that side of the booking that was returned — no more, no less.
    --
    -- Full refund → nothing owed. Late cancellation, where the driver gets
    -- nothing back because the space was held for them → owed in full, exactly
    -- as a Connect host would already have kept their 85%.
    case
      when coalesce(b.refund_pence, 0) <= 0 then b.operator_share_pence
      when coalesce(b.booking_price_pence, 0) + coalesce(b.surcharge_pence, 0) <= 0 then 0
      else greatest(0, b.operator_share_pence - round(
             b.operator_share_pence::numeric
             * least(1, coalesce(b.refund_pence, 0)::numeric
                        / (coalesce(b.booking_price_pence, 0) + coalesce(b.surcharge_pence, 0)))
           )::integer)
    end as operator_due_pence
  from public.bookings b
  where b.payout_mode = 'invoice'
    -- 'paid' is the ordinary case. A CANCELLED booking belongs here too,
    -- because the arithmetic above is what decides whether anything is still
    -- owed on it. Filtering on status = 'paid' alone — which is what this view
    -- did first — would quietly stop paying an operator for every no-show and
    -- late cancellation, the bookings where the money was kept in full.
    -- Only a paid booking can be cancelled, so nothing unpaid gets in.
    and b.status in ('paid', 'cancelled')
)
select
  l.id                                            as listing_id,
  l.title                                         as car_park,
  l.operator_share_pct,
  s.period_month,
  count(*)                                        as bookings,
  sum(s.amount_total_pence)                       as gross_collected_pence,
  sum(s.refund_pence)                             as refunded_pence,
  sum(s.operator_due_pence)                       as operator_share_due_pence,
  sum(s.amount_total_pence) - sum(s.refund_pence)
    - sum(s.operator_due_pence)                   as parkeasy_net_pence
from settled s
join public.rental_listings l on l.id = s.listing_id
group by l.id, l.title, l.operator_share_pct, s.period_month;

grant select on public.booking_settlements to authenticated;

comment on view public.booking_settlements is
  'Bookings taken under the invoice model, grouped by car park and month. '
  'Stripe has NOT paid these operators — this is the list of what ParkEasy owes '
  'them and has to send. operator_share_due_pence is already net of refunds.';
