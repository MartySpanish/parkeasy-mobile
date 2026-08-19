-- Davitt Park comes off the featured slot. APPLIED 19 Aug 2026.
--
-- Marty's call, and his reasoning: £20 a visit is dear for what it is, and the
-- demand that justified the position was Féile. Féile is over. A pinned card
-- above the fold is the most valuable space in the app, and it should not be
-- held by the listing least likely to convert this week.
--
-- ── WHAT THIS DOES AND DOES NOT DO ────────────────────────────────────────
-- featured drives ONE thing: the FeaturedSpace block that sits above the
-- how-it-works and Premium cards on the landing screen. Clearing it moves
-- Davitt Park down into the ordinary results; it does NOT delist it. status
-- stays 'active', the price is untouched, and it remains searchable, bookable
-- and payable exactly as before. Anyone who wants it still finds it.
--
-- ── THE BLOCK GOES EMPTY, WHICH IS FINE ───────────────────────────────────
-- Davitt Park is the only row with featured = true — the only ACTIVE bookable
-- site ParkEasy has at all, the other active listing being a £3/hr private
-- space. So this leaves nothing featured and the whole block stops rendering,
-- because App.jsx guards it on featured.length > 0. An empty pinned slot is
-- not a bug here; it is the honest state of a marketplace with one seller
-- whose peak week has passed.
--
-- The knock-on is worth naming: the landing screen now leads with search and
-- the partner card rather than with something to buy. If bookings fall off a
-- cliff this is the first thing to put back, and putting it back is one line.
--
-- NOT TOUCHED: src/data/bookableSpaces.js still advertises Davitt Park at
-- £23.00 all-in on the static /area/*.html pages. That is the SEO surface, a
-- separate decision from where the card sits in the app, and taking a site off
-- it removes the only sellable space those pages name. Raised with Marty
-- rather than assumed.
--
-- To reverse: set featured = true on the same row.

update public.rental_listings
set featured = false
where id = '28b6cef9-aa76-4b26-b69b-0b7be7370684';
