-- Tara Lodge's pin. Switches the parking map on.
--
-- 20260817_tara_lodge.sql shipped with geo_verified = false and the
-- Belfast-centre placeholder, because every geocoder is blocked from the
-- environment this was written in — Google Maps, Nominatim, Photon, Overpass,
-- postcodes.io and taralodge.com itself all answer 403 at the egress proxy.
-- Guessing a coordinate is what put Gransha Grill 953m from its own front door
-- and dragged three parking spots along with it, so it shipped unpinned.
--
-- ── WHERE THIS NUMBER CAME FROM ───────────────────────────────────────────
-- Two independent routes, agreeing to six decimal places.
--
--  1. OSNI Irish Grid reference published for BT7 1JW: E 333754, N 373031.
--     Converted offline — Transverse Mercator on the Airy Modified 1849
--     ellipsoid (F0 1.000035, origin 53.5N 8W, false origin 200000/250000),
--     then the OSi/OSNI Helmert from Ireland 1965 (TM75) to WGS84
--     (tx +482.530, ty -130.596, tz +564.557, rx -1.042", ry -0.214",
--     rz -0.631", s +8.150 ppm). Result: 54.587835, -5.931730.
--
--     The conversion itself was checked before its output was trusted:
--     Belfast City Hall's grid reference through the same code lands 16m from
--     the coordinate already in ParkEasy's own dataset. A wrong ellipsoid or
--     a wrong datum shift misses by hundreds of metres, not sixteen.
--
--  2. The published decimal centroid for BT7 1JW: 54.58783500, -5.93173000.
--     Same number, arrived at without touching the grid reference.
--
-- ── WHAT IT IS, AND WHAT IT IS NOT ────────────────────────────────────────
-- HONESTLY: this is the postcode CENTROID for BT7 1JW, not a survey of Tara
-- Lodge's front door. BT7 1JW is a short run of Cromwell Road — numbers 8, 10,
-- 34, 36 — so the centroid sits within a few tens of metres of the building.
--
-- That tolerance is fine for what the pin actually drives, and it is worth
-- being precise about why: geo_verified controls a map of the parking AROUND
-- the business and a nearby-spots list computed at a 700m radius. Tens of
-- metres cannot change which streets that returns. Gransha's error was 953m —
-- a different neighbourhood, not a rounding difference. If somebody sends an
-- Apple Maps share link for the door later, replace these two numbers; nothing
-- else needs to change.
--
-- Sanity checks on the result, all consistent with a hotel on Cromwell Road:
--   987m from Belfast City Hall  (they advertise a 10-15 minute walk)
--   435m from University Road and Botanic Gardens  (their "5 min to Botanic")
--   515m from the Botanic Avenue side streets
--
-- The nearby-spots list this turns on, checked against the real dataset:
--   NCP Dublin Road 360m · University Road on-street 435m ·
--   Ormeau Road on-street 447m · Dublin Road on-street 493m ·
--   Botanic Avenue side streets 515m
-- Every one a genuine Queen's Quarter answer, and the same streets the
-- partner's own description already names.

update partners set
  lat = 54.587835,
  lng = -5.931730,
  geo_verified = true
where slug = 'tara-lodge';
