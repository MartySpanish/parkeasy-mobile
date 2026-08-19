-- Paul's Barbers — ninth featured partner, and a pin that was wrong.
-- APPLIED 19 Aug 2026.
--
-- The row was created earlier the same day in another session, with the images
-- missing. This adds them and corrects the location.
--
-- ── THE PIN WAS SOMEBODY ELSE'S ─────────────────────────────────────────────
-- It carried lat 54.573287, lng -5.988669 with geo_verified = true and no
-- address. That coordinate is Aaron Quinn Hair's — 134a Andersonstown Road,
-- BT11 9BY, added hours earlier.
--
-- Two barbers cannot share a front door. Left alone, Paul's card would have
-- drawn a map of Aaron's street and listed Aaron's parking — the leisure
-- centre and the PD — under "Parking near Paul's Barbers", stated with total
-- confidence. That is the Gransha Grill 953m error with a second real business
-- underneath it, and nothing would have looked broken.
--
-- Reset to the Belfast-centre placeholder with geo_verified = false, which is
-- exactly what the flag exists for: no map, no nearby list, and the card offers
-- "See photos & details" instead of parking it cannot supply.
--
-- ── WHAT IS STILL MISSING ───────────────────────────────────────────────────
-- Where the shop actually is. The logo carries Facebook and Instagram marks but
-- no handles, and "Paul's Barbers" does not resolve to one place. Address, pin
-- and booking link are a two-line update once Marty says.
--
-- ── COPY ────────────────────────────────────────────────────────────────────
-- Fades, tapers and textured crops — what is visibly in his own photos, and
-- nothing beyond it. Same rule that took three invented sports off Jack
-- Daniels' listing.
update partners set
  tagline     = 'Barbering in Northern Ireland — fades, tapers and textured crops.',
  description = E'Paul''s Barbers. Skin fades, tapers and textured crops — the photos here are his own work.\n\nFind them on Facebook and Instagram for opening hours and to get booked in.',
  logo_url    = 'https://parkeasy.uk/paulsbarbers/logo.jpg',
  photo_url   = 'https://parkeasy.uk/paulsbarbers/1-skin-fade.jpg',
  photo_urls  = array[
    'https://parkeasy.uk/paulsbarbers/1-skin-fade.jpg',
    'https://parkeasy.uk/paulsbarbers/2-textured-crop.jpg',
    'https://parkeasy.uk/paulsbarbers/3-back-taper.jpg'
  ],
  lat = 54.5973, lng = -5.9301, geo_verified = false,
  active = true
where slug = 'pauls-barbers';
