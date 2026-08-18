-- Aaron Quinn Hair: the branch, confirmed. APPLIED 18 Aug 2026.
--
-- Cut N Edge has two Belfast shops and the listing shipped unpinned because
-- nothing said which one Aaron works at. Marty confirmed: Andersonstown Road.
--
-- ── THE COORDINATE ───────────────────────────────────────────────────────
-- 134a Andersonstown Road, Belfast BT11 9BY → 54.573287, -5.988669.
--
-- The published decimal centroid for BT11 9BY, which streetcheck records
-- against Andersonstown Road. Every geocoder is blocked from this environment,
-- so it was checked by triangulation against pins already trusted in this
-- database rather than taken on faith:
--
--   4652m from Belfast City Hall   — Andersonstown is ~4.5km SW of the centre
--   1109m from Gransha Grill        — Glen Road runs parallel, about a km north
--   3800m from Jack Daniels         — up the Falls from Conway Mill
--   2845m from The Red Devil        — further down the Falls Road
--
-- All four land where Andersonstown Road belongs. As with Tara Lodge this is
-- the POSTCODE CENTROID, not the shop door — good to tens of metres on a
-- street of shops, which is well inside what the radius below is for.
--
-- ── WHY THE RADIUS IS 1300, NOT 700 ──────────────────────────────────────
-- His card offers "photos & parking nearby" and at 700m there was nothing to
-- show: the nearest mapped spot is Colin Glen at 994m. An empty list under
-- that promise is worse than a walk time somebody can judge for themselves,
-- and the list prints walk times, so twelve minutes reads as twelve minutes.
--
-- 1300m reaches Lidl Andersonstown Road — on his own road — and Colin Glen.
--
-- WORTH SAYING PLAINLY: this is papering over a coverage gap. ParkEasy maps
-- nothing on the Andersonstown Road itself, a busy shopping street with
-- on-street parking outside every shop. Adding real spots there is the actual
-- fix, and it would help far more people than one barber's card.
update partners set
  address      = '134a Andersonstown Road, Belfast',
  postcode     = 'BT11 9BY',
  lat          = 54.573287,
  lng          = -5.988669,
  geo_verified = true,
  radius_m     = 1300,
  description  = E'Aaron cuts at Cut N Edge Barbers on the Andersonstown Road, Tuesday through Saturday. Fades, tapers and longer layered cuts — the photos here are his own work.\n\nBooking is online through Cut N Edge rather than by phone. Cut N Edge has two Belfast shops, so choose the Andersonstown Road one.'
where slug = 'aaron-quinn-hair';
