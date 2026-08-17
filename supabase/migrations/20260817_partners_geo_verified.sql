-- Separate "we know the address" from "we trust the pin". APPLIED 17 Aug 2026.
--
-- The parking map was suppressed when `address` was null. That was a proxy,
-- and Marty found exactly where it breaks. He confirmed Jack Daniels is at
-- Conway Mill, 5-7 Conway Street BT13 2DE — so the address is known — but
-- every geocoder, Google Maps, Wikipedia, Wikidata and the mill's own website
-- are blocked from this environment, so there is still no coordinate.
--
-- Filling in the address alone would have switched the map on and drawn it at
-- the Twin Spires anchor on Northumberland Street, half a kilometre away on
-- the wrong street. That is precisely the Gransha Grill failure: pinned 953m
-- from its own front door, dragging three parking spots with it.
--
-- The address was never the thing that mattered. The coordinate is.
alter table partners
  add column if not exists geo_verified boolean not null default false;

comment on column partners.geo_verified is
  'True only when this lat/lng has been confirmed as the business itself. '
  'Gates the parking map. Never set true for a placeholder or an estimate.';

-- Default false, so a new partner never draws a map until somebody says so.
-- That is the safe direction, and the opposite of what the proxy gave us.
update partners set geo_verified = true
 where slug in ('the-red-devil', 'gransha-grill', 'sbg-maeda-belfast', 'sandy-mcdermott-sc');

-- marcus-donnelly-fitness  online; lat/lng is the Belfast-centre placeholder
-- jack-daniels-fitness     address confirmed, coordinate still unknown
update partners set geo_verified = false
 where slug in ('marcus-donnelly-fitness', 'jack-daniels-fitness');
