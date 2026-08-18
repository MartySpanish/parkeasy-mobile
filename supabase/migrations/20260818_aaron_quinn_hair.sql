-- Aaron Quinn Hair — eighth featured partner. APPLIED 18 Aug 2026.
--
-- A barber Marty knows, cutting at Cut N Edge Barbers in Belfast. Free
-- placement, same as every other local business on the app: no fee, no term,
-- so no ends_at.
--
-- ── WHY THERE IS NO PIN ──────────────────────────────────────────────────
-- Cut N Edge has TWO Belfast branches — 90-92 Shaws Road (BT11 9QR) and 134a
-- Andersontown Road (BT11 9BY) — and nothing available says which one Aaron
-- works at. His Instagram says "Belfast" and the booking link is the shop's
-- Nearcut page, whose first screen is literally "Choose a shop".
--
-- Picking one would be a coin toss that sends drivers to the wrong side of
-- west Belfast. So: no address, geo_verified false, and the description tells
-- the customer to choose the branch that suits where they parked — which is
-- what the booking page asks them anyway. Confirm the branch with Aaron and
-- this becomes a two-line update.
--
-- ── WHAT THE COPY DOES NOT SAY ───────────────────────────────────────────
-- No specialities beyond what is visibly in his own photos: fades, tapers and
-- longer layered cuts. Jack Daniels' listing once claimed three sports
-- inferred from emoji in an Instagram bio, and inventing a real person's
-- craft is not a mistake worth repeating. Anything more comes from Aaron.
insert into public.partners
  (slug, name, tagline, description, logo_url, photo_url, photo_urls,
   link_url, links, is_online, address, postcode, lat, lng, radius_m,
   priority, geo_verified, active)
values (
  'aaron-quinn-hair',
  'Aaron Quinn Hair',
  'Belfast barber at Cut N Edge — Tuesday to Saturday, booked online.',
  E'Aaron cuts at Cut N Edge Barbers in Belfast, Tuesday through Saturday. Fades, tapers and longer layered cuts — the photos here are his own work.\n\nBooking is online through Cut N Edge rather than by phone, and the booking page asks which shop you want, so pick whichever branch suits where you are parking.',
  'https://parkeasy.uk/aaronquinn/logo.jpg',
  'https://parkeasy.uk/aaronquinn/1-side-mullet.jpg',
  array[
    'https://parkeasy.uk/aaronquinn/1-side-mullet.jpg',
    'https://parkeasy.uk/aaronquinn/2-skin-fade.jpg',
    'https://parkeasy.uk/aaronquinn/3-back-taper.jpg'
  ],
  'https://cutnedgebarbers.nearcut.com/',
  '[{"label":"Book with Aaron","url":"https://cutnedgebarbers.nearcut.com/"},
    {"label":"See his work on Instagram","url":"https://www.instagram.com/aaronquinnhair_/"}]'::jsonb,
  false,
  null, null,
  -- Belfast centre placeholder, used only to match him to a city.
  54.5973, -5.9301,
  700,
  -- Between Gransha (3) and Marcus (-1): a new free placement starts low and
  -- gets promoted on merit rather than on being newest.
  2,
  false,
  true
)
on conflict (slug) do update set
  name = excluded.name, tagline = excluded.tagline, description = excluded.description,
  logo_url = excluded.logo_url, photo_url = excluded.photo_url,
  photo_urls = excluded.photo_urls, link_url = excluded.link_url,
  links = excluded.links, active = excluded.active;
