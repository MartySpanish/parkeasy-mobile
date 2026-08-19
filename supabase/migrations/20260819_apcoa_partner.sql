-- APCOA as a featured partner.
--
-- WHAT WAS ALREADY TRUE BEFORE THIS FILE. APCOA's four Northern Irish car
-- parks have been in the app since 18 August as ordinary spots with
-- partner:true (src/apcoaSpots.js) — Lanyon Place and Oxford Street in
-- Belfast, Daisy Hill in Newry, Craigavon Area Hospital. That flag stops them
-- being ranked as a competitor and puts a "ParkEasy partner" badge on the
-- card. What it never did was give APCOA a row in this table, which is the
-- rail every other partner sits in: the featured block on the landing screen
-- and the cards spaced through the results. This adds that, and nothing else.
--
-- WHAT THIS ROW MUST NOT CLAIM, AND WHY. The Heads of Terms is a DRAFT dated
-- 17 August 2026, marked "subject to contract, not legally binding", and has
-- not come back signed. The two Belfast rental_listings are still
-- status='draft' with no agreed price, no bay count and no Stripe account, and
-- the discounted booking link has not arrived. So there is no "book with
-- ParkEasy", no "ParkEasy rate" and no discount anywhere in this text. The
-- prices the app shows are APCOA's own published barrier tariffs, presented as
-- information, exactly as they already were. If the contract comes back signed
-- with a rate attached, that is a new migration, not an edit to this one.
--
-- PRIORITY 19: SECOND, NOT FIRST. Marty set the order deliberately and put
-- Tara Lodge at the top; a partner that is putting ParkEasy in its own
-- pre-stay email keeps the featured block. 19 makes APCOA the first
-- interleaved card instead, which is the highest position that leaves that
-- decision alone. Everyone below keeps their relative order untouched.
--
-- geo_verified STAYS FALSE, on purpose. The coordinate below is Lanyon Place,
-- approximate from its postcode, and APCOA has no single front door anyway —
-- the app measures a network partner from its NEAREST car park instead (see
-- src/data/networkPartners.js), which is what makes this one row show up in
-- Newry and Craigavon as well as Belfast. Nothing in the app reads this pin as
-- exact, and marking it verified would be the one sentence in this file that
-- was not true.
insert into public.partners (
  slug, name, tagline, description, link_url, links,
  lat, lng, geo_verified, radius_m, is_online, priority, active
) values (
  'apcoa',
  'APCOA',
  E'The operator behind several of the paid car parks ParkEasy already lists — Lanyon Place and Oxford Street in Belfast, and the hospital car parks at Daisy Hill and Craigavon.',
  E'APCOA runs car parks across the UK and Europe, and is the operator behind several of the paid car parks ParkEasy already lists in Northern Ireland: the multi-storeys at Lanyon Place and Oxford Street in Belfast, and the pay-and-display parking at Daisy Hill Hospital in Newry and Craigavon Area Hospital.\n\n'
    || E'The Belfast sites are barrierless ANPR — you drive in and pay online or in the APCOA Connect app rather than at a machine — and Lanyon Place has EV charging bays. The hospital car parks are pay and display, managed and enforced by APCOA for the Southern Health and Social Care Trust.\n\n'
    || E'Prices shown on ParkEasy are APCOA''s own published tariffs and you pay APCOA directly. These are not ParkEasy bookings, so check the current rate on site or in the app before you park.',
  'https://www.apcoa.co.uk/',
  '[{"label":"Visit APCOA","url":"https://www.apcoa.co.uk/"}]'::jsonb,
  54.5978, -5.9161, false, 800, false, 19, true
)
on conflict (slug) do update set
  name        = excluded.name,
  tagline     = excluded.tagline,
  description = excluded.description,
  link_url    = excluded.link_url,
  links       = excluded.links,
  lat         = excluded.lat,
  lng         = excluded.lng,
  geo_verified= excluded.geo_verified,
  radius_m    = excluded.radius_m,
  is_online   = excluded.is_online,
  priority    = excluded.priority,
  active      = excluded.active;

-- The order after this file, top to bottom:
--   Tara Lodge 20 · APCOA 19 · SBG Maeda 18 · Sandy McDermott 16 ·
--   Jack Daniels 14 · The Red Devil 12 · Paul's Barbers 11 ·
--   Aaron Quinn Hair 10 · Marcus Donnelly 8 · Gransha Grill 6
--
-- Ten partners, and ten positions on the landing screen: one featured block
-- plus nine interleaved slots. During a search there is no featured block, so
-- all ten need a slot — which is why PARTNER_SLOTS gained a tenth at 44 and
-- PAGE went from 40 to 48 in the same change. Adding an eleventh partner
-- without adding a slot silently drops somebody off the end; it has happened
-- at four, five, six, seven and eight, and it never errors.
