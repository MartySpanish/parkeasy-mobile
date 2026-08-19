-- Did a booking start at a free spot?
--
-- APPLIED to production project bbgqregyogtjzaustbng on 19 Aug 2026.
--
-- THE QUESTION THIS COLUMN EXISTS TO ANSWER, and it is the one that decides
-- what ParkEasy does next: are the 745 hand-checked free spots the top of the
-- marketplace funnel, or are they cannibalising it?
--
-- If drivers who come for a free space go on to book a paid one, every hour
-- spent mapping free parking pays for itself. If they never do, the free spots
-- are competing with the only thing that makes money and the answer is a
-- different product, not more spots. Nobody could tell in either direction.
--
-- WHY A COLUMN AND NOT JUST AN ANALYTICS EVENT. The client fires
-- booking_completed_from_hotspot on the return from Stripe, and that event is
-- lost every time somebody closes the tab on the Stripe receipt page — which is
-- precisely when the booking is most complete. The event is for the funnel
-- shape; this column is for the number anybody makes a decision on.
alter table public.bookings
  add column if not exists from_hotspot boolean not null default false;

comment on column public.bookings.from_hotspot is
  'True when the driver reached this booking from a free/hidden-gem spot via the '
  'comparison card (src/components/funnel/ComparisonCard.jsx). Set server-side '
  'from Stripe checkout metadata, so it survives the driver closing the tab.';

create index if not exists bookings_from_hotspot_idx
  on public.bookings (from_hotspot, created_at desc) where from_hotspot;
