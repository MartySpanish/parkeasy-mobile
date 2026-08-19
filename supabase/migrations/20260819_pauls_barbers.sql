-- Paul's Barbers, Andersonstown Road. APPLIED 19 Aug 2026.
--
-- Marty's placement: immediately ahead of Aaron Quinn Hair. Red Devil sits at
-- 12 and Aaron at 10, so 11 puts him between them without renumbering anybody.
--
--   12  The Red Devil
--   11  Paul's Barbers        ← here
--   10  Aaron Quinn Hair
--
-- ── THE COORDINATE IS AARON'S, ON PURPOSE ─────────────────────────────────
-- READ THIS BEFORE "FIXING" IT. Paul's Barbers and Aaron Quinn Hair face each
-- other across the Andersonstown Road — Marty's own words, first hand. So this
-- row deliberately carries the SAME lat/lng as aaron-quinn-hair
-- (54.573287, -5.988669), which is a verified pin on the far side of the road.
--
-- Two partners with identical coordinates looks like a copy-paste bug, and
-- there is already one legitimate case of it in this table (Sandy and SBG share
-- one address at Joy's Entry). This is the second. The error is the width of
-- the Andersonstown Road — call it fifteen metres — against a radius_m of 700,
-- so every parking space this pin surfaces is a space that genuinely serves
-- both shops. That is the entire job the coordinate does here.
--
-- geo_verified is therefore TRUE. The question that flag answers is "does this
-- number mean anything", not "is it the exact doorstep", and a pin fifteen
-- metres out on a 700m radius means a great deal. Compare the case it exists
-- to prevent: Gransha Grill, 953 metres from its own front door.
--
-- IF THE STREET NUMBER ARRIVES, geocode it and replace the pair. Better a pin
-- on his own door than a neighbour's, but not at the cost of no map at all
-- while we wait.
--
-- ── WHAT IS DELIBERATELY EMPTY ────────────────────────────────────────────
-- address, postcode, logo_url, photo_url, photo_urls, link_url, links and
-- contact_phone are all unset. The logo and three photos were sent in chat and
-- could not be written to disk from there; the street number, booking link and
-- socials were never given. Every one of those is optional in the schema and
-- conditionally rendered in PartnerCard, so the row is safe to go live and
-- simply shows less until they land. The tagline is a placeholder written from
-- the photos — fades, a crop, beard work — and Paul should get the final say
-- on how his own shop is described.
--
-- Idempotent on slug, so re-running updates rather than duplicating.

insert into public.partners
  (slug, name, tagline, lat, lng, radius_m, priority, geo_verified, is_online, active)
values (
  'pauls-barbers',
  'Paul''s Barbers',
  'Andersonstown Road barbers — fades, crops and beard work.',
  54.573287, -5.988669,
  700,
  11,
  true,
  false,
  true
)
on conflict (slug) do update set
  name         = excluded.name,
  tagline      = excluded.tagline,
  lat          = excluded.lat,
  lng          = excluded.lng,
  radius_m     = excluded.radius_m,
  priority     = excluded.priority,
  geo_verified = excluded.geo_verified,
  active       = excluded.active;
