-- Belfast Royal Academy goes back on the app, but cannot be booked.
-- APPLIED 19 Aug 2026.
--
-- Marty: "Add BRA but don't let them book." Two halves, and the second half is
-- the one that matters — a space nobody has agreed to open must not be
-- sellable. On 8 August two drivers paid for Davitt Park and found the gates
-- locked. That is the failure this row is deliberately arranged to prevent.
--
--   status           hidden → active      so it is VISIBLE again
--   available_until  2026-08-21 → 08-18   so it CANNOT be sold
--   featured         stays false          it does not take the pinned slot
--   price_per_day    £15.00 untouched     the commercial terms are not lost
--
-- ── WHY THE WINDOW, AND NOT SOMETHING ELSE ────────────────────────────────
-- api/checkout/create-session.js has exactly three server-side refusals that
-- could do this job, and only one of them is right:
--
--   status <> 'active'   refuses — but the app only fetches active listings,
--                        so the space would be invisible. That is the state it
--                        was already in, and the opposite of "add".
--   no price set         refuses — but it would throw away the £15 the school
--                        agreed, and "unpriced" is not what is true here.
--   outside the window   refuses, keeps the price, and says the honest thing:
--                        this car park is not taking bookings.
--
-- So the window. It is compared INCLUSIVELY against the booking day
-- (`day > until`), in Europe/London, so a closed window refuses every date a
-- driver can pick — today, tomorrow, next year. Verified against a replica of
-- that comparison before this was applied.
--
-- ── ABOUT THAT DATE ───────────────────────────────────────────────────────
-- The signed licence ran to 21 AUGUST 2026. 18 August is not that date; it is
-- yesterday, chosen because "closed" has to mean closed TODAY and the real end
-- date was still two days out. The licence date is recorded here so it is not
-- lost by being overwritten in the column. If the school agrees a new window,
-- put the real dates back — do not treat 18 August as meaningful.
--
-- ── THE CLIENT HAD TO CHANGE TOO ──────────────────────────────────────────
-- The server has always enforced this window; the app never read it. The
-- Reserve & pay gate tested price alone, so a listing whose window had closed
-- still offered a button that checkout would then refuse — the exact refusal
-- the gate's own comment says it exists to make impossible. src/App.jsx now
-- fetches available_from/available_until and shares one sellableNow() test with
-- the same rule, and a listing that is live but not selling says so on its card
-- instead of claiming "Bookable · book in advance" with no button under it.
--
-- To sell it again: set available_from/available_until to the agreed dates.
-- Nothing else needs touching.

update public.rental_listings
set status          = 'active',
    available_until = '2026-08-18',
    featured        = false
where id = '392769f2-8c06-407e-875b-68aa94aa0639';
