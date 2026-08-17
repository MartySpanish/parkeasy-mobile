-- Tara Lodge — featured partner, Queen's Quarter, Belfast.
--
-- Sinéad (sinead@taralodge.com) said yes on 12 Aug and offered to put ParkEasy
-- into Tara Lodge's own pre-stay email to guests, which is the most valuable
-- thing any partner has offered us: it reaches a driver at the exact moment
-- they are working out where to leave the car.
--
-- FREE placement as an early Belfast partner. No fee, no term, nothing owed —
-- so there is deliberately no ends_at. Same arrangement as Jack Daniels.
--
-- ── WHAT THE COPY MAY AND MAY NOT SAY ─────────────────────────────────────
-- Every factual claim below is either from Tara Lodge's own site or repeated
-- across the trade listings (Frommer's, Tripadvisor, Booking, trivago):
--
--   * 36 Cromwell Road, Belfast BT7 1JW
--   * 4-star boutique guest accommodation, 34 rooms
--   * FREE, SECURE, ON-SITE car parking — "one of the few accommodation
--     providers in central Belfast" that has it, in their own words
--   * complimentary WiFi throughout; à la carte breakfast
--   * Queen's Quarter — Queen's University, the Ulster Museum and Botanic
--     Gardens on the doorstep, roughly fifteen minutes' walk to the centre
--
-- What it must NOT say is what the pitch mock-up said: "book a guaranteed
-- space near Tara Lodge before you set off". There is no bookable inventory
-- anywhere near Cromwell Road — Davitt Park and the Academy are both off sale
-- — so that sentence sells a driver something that does not exist, on a card
-- belonging to a business that would carry the complaint. It is also the wrong
-- pitch: Tara Lodge's parking is free and it is theirs. The honest and more
-- useful line is the one below — their guests are already sorted, and ParkEasy
-- is for the people visiting them who are not.
--
-- ── WHY geo_verified IS FALSE ─────────────────────────────────────────────
-- Cromwell Road is a short street off Botanic Avenue and it would be very easy
-- to put a pin within a couple of hundred metres of the door. Every geocoder,
-- Google Maps and taralodge.com itself are blocked from this environment, so
-- "very easy" means "invented". Gransha Grill was pinned 953m from its own
-- front door exactly that way, and it dragged three parking spots with it.
--
-- lat/lng below are the Belfast-centre placeholder the NOT NULL columns
-- demand. They decide which city's list Tara Lodge appears in and NOTHING
-- else: geo_verified = false suppresses the parking map and the nearby-spots
-- list on both the card and the business page. Flip it to true in one line the
-- day somebody confirms a real coordinate — an Apple Maps share link is enough.

insert into public.partners
  (slug, name, tagline, description, logo_url, photo_url, photo_urls,
   link_url, links, is_online, address, postcode, lat, lng, radius_m,
   priority, geo_verified, active)
values (
  'tara-lodge',
  'Tara Lodge',
  E'4-star boutique hotel in the Queen\'s Quarter — and one of the few places in central Belfast with free, secure parking of its own.',
  E'A 34-room boutique hotel on a quiet residential street off Botanic Avenue, five minutes from Queen\'s University and the Ulster Museum and about fifteen minutes\' walk from the city centre.\n\nThe part that matters if you are driving: Tara Lodge has its own free, secure on-site car park, which almost nothing else this close to the middle of Belfast can say. Guests are not paying for parking and not circling for it. Breakfast is à la carte and made to order, and the WiFi is free throughout.\n\nVisiting rather than staying? Cromwell Road sits in the middle of the Botanic and Queen\'s parking that ParkEasy already maps — free evening and weekend kerbside on the side streets, and the University Road bays after 6pm.',
  null,
  'https://parkeasy.uk/taralodge/1-exterior.jpg',
  array[
    'https://parkeasy.uk/taralodge/1-exterior.jpg',
    'https://parkeasy.uk/taralodge/2-reception.jpg'
  ],
  'https://www.taralodge.com/',
  '[{"label":"Book a room at Tara Lodge","url":"https://www.taralodge.com/"}]'::jsonb,
  false,
  '36 Cromwell Road, Belfast',
  'BT7 1JW',
  -- PLACEHOLDER. Belfast city centre, not Cromwell Road. See the note above:
  -- geo_verified = false is what stops this ever being shown as a location.
  54.5973, -5.9301,
  700,
  -- Between Gransha Grill (3) and SBG Maeda (5). A hotel that is going to put
  -- us in front of its own guests earns a place above the partner four
  -- kilometres out, and does not need to outrank the gyms drivers came looking
  -- for. All seven show regardless — PARTNER_SLOTS now has seven positions.
  4,
  false,
  true
)
on conflict (slug) do update set
  name         = excluded.name,
  tagline      = excluded.tagline,
  description  = excluded.description,
  photo_url    = excluded.photo_url,
  photo_urls   = excluded.photo_urls,
  link_url     = excluded.link_url,
  links        = excluded.links,
  address      = excluded.address,
  postcode     = excluded.postcode,
  radius_m     = excluded.radius_m,
  priority     = excluded.priority,
  active       = excluded.active;
-- geo_verified deliberately NOT in the update list. If somebody has since
-- confirmed the pin and set it true, re-running this file must not quietly
-- switch the map back off.
