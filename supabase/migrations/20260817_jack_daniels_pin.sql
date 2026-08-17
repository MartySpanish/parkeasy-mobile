-- Jack Daniels Fitness: the pin, confirmed at last.
--
-- Marty shared Apple Maps' own place card for Atlas Gym Belfast:
--   3rd Floor, Conway Mill, 5-7 Conway Street, Belfast BT13 2DE
--   coordinate=54.599499,-5.951222
--
-- Every geocoder, Google Maps, Wikipedia, Wikidata and conway-mill.ie are
-- blocked from this environment, which is why this took three attempts and why
-- the map stayed off in the meantime rather than being drawn from the
-- Northumberland Street anchor half a kilometre away.
--
-- Cross-checked before trusting it, because a coordinate that arrives by
-- copy-paste deserves the same scepticism as one that is inferred:
--   276m   from Twin Spires, Northumberland Street — the adjacent cross-street
--  1410m   west of Belfast City Hall — right for the Lower Falls
--   956m   from The Red Devil, further up the Falls Road
--   none   of our 78 spots already within 80m
--
-- geo_verified goes true in the same statement as the coordinate, on purpose:
-- they are one fact, and setting either without the other is what the flag
-- exists to prevent.
update partners set
  lat = 54.599499,
  lng = -5.951222,
  geo_verified = true,
  address = '3rd Floor, Conway Mill, 5-7 Conway Street, Belfast',
  postcode = 'BT13 2DE'
where slug = 'jack-daniels-fitness';
