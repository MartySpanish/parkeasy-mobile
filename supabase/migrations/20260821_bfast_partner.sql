-- BFAST as a featured partner.
--
-- Marty's ask, 21 August: add BFAST, link their Instagram and their website.
-- Friends of his, and the two fighters on the account are not a marketing
-- claim — both titles were checked against independent sources before they
-- went in the copy below:
--
--   Niall McGreevy   WBC Muay Thai WELTERWEIGHT world champion. Won the belt
--                    against Detchrit Sitsonpeenong in Verona and defended it
--                    against Arjan Hajdari in Glasgow. Has a Wikipedia page.
--   Garrett Smylie   WBC Muay Thai SUPER-WELTERWEIGHT world champion, beating
--                    Tristian Stauffer by fourth-round TKO in Bangkok.
--
-- Marty described them as "one of the top Muay Thai fighters in the world" and
-- "literally WBC champion". Both are true, and naming the actual belts is
-- better copy than the superlative as well as being checkable — so that is
-- what the description says. Sources: wbcmuaythai.com, belfastmedia.com,
-- irishnews.com.
--
-- "a fight-wear, training & lifestyle brand built in Belfast, created by World
-- Champions" is BFAST'S OWN wording from their Instagram bio, used as theirs.
-- Not "made in Belfast" — where the kit is manufactured is not something
-- anybody has told us, and it is the kind of small upgrade that turns a true
-- sentence into a false one.
--
-- ── NOT A NETWORK PARTNER, DELIBERATELY ──────────────────────────────────────
-- APCOA sits in src/data/networkPartners.js because it has no front door and
-- because the free kerbside around a barrier is the list of its COMPETITORS.
-- Neither applies here. BFAST has a real premises, and Marty's opening pitch to
-- them was "there's parking all round it in the street" — the parking map is
-- the entire point of the page for this partner, so an np entry (which
-- suppresses it) would remove the thing they were sold on.
--
-- ── THE PIN IS BORROWED, AND THAT IS WHY IT IS TRUSTED ───────────────────────
-- Every geocoder is blocked from this environment. But Jack Daniels Fitness is
-- already in this table at the SAME BUILDING — "3rd Floor, Conway Mill, 5-7
-- Conway Street, BT13 2DE" — with geo_verified=true at 54.599499,-5.951222,
-- and an independent lookup of Conway Mill's own address puts it at
-- 54.59932,-5.95126, about 25 metres away. Two sources agreeing to within the
-- width of the mill is a verified pin, so address and geo_verified go in
-- together and the parking map switches itself on. (Contrast Gransha Grill,
-- pinned 953m from its own door by a guess, and Jack Daniels before the fix.)
--
-- ── PRIORITY 17 ──────────────────────────────────────────────────────────────
-- An unused number, chosen so that NOBODY ELSE MOVES. 17 puts BFAST fourth,
-- behind Tara Lodge (20), APCOA (19) and SBG Maeda (18) and ahead of Sandy
-- McDermott (16), and every existing partner keeps the exact position Marty
-- set. No partner in this table is paying — price_pence is null on all eleven —
-- so this is an editorial order and not a sold one, but it is still HIS order.
--
-- ── ⚠️ THE WEBSITE LINK IS NOT HERE, AND IT IS NOT AN OVERSIGHT ──────────────
-- Marty asked for it. Their Instagram bio says "Link in Bio" and Instagram is
-- blocked by the egress proxy from this environment, so the shop URL could not
-- be read. Six plausible domains were probed and none resolved through the
-- proxy either. Inventing one would either 404 or — worse — send drivers to
-- somebody else's shop under BFAST's name.
--
-- Instagram is the link that IS verified (it is on the screenshots Marty sent),
-- and it is one tap from the shop, so the card works today. To add the real
-- one, put it first in `links` and set link_url to match; the first entry is
-- rendered as the primary button.
insert into public.partners (
  slug, name, tagline, description, link_url, links,
  address, postcode, lat, lng, geo_verified, radius_m, is_online,
  priority, active, notes
) values (
  'bfast',
  'BFAST',
  E'Fightwear, training and lifestyle kit — built in Belfast by world champions.',
  E'BFAST is a fight-wear, training and lifestyle brand built in Belfast and, in their own words, created by world champions.\n\n'
    || E'The two faces of it are Niall McGreevy, WBC Muay Thai welterweight world champion, and Garrett Smylie, WBC Muay Thai super-welterweight world champion — both from west Belfast, and both fighting in the kit they design.\n\n'
    || E'The BFAST office and gym are in Conway Mill on Conway Street, just off the Falls Road, with street parking all around the mill.\n\n'
    || E'Follow on Instagram for the drops — they sell out.',
  'https://www.instagram.com/bfastofficial/',
  '[{"label":"Follow on Instagram","url":"https://www.instagram.com/bfastofficial/"}]'::jsonb,
  'Conway Mill, 5-7 Conway Street, Belfast',
  'BT13 2DE',
  -- Conway Mill. Same building as Jack Daniels Fitness, whose pin is already
  -- geo_verified in this table; corroborated to ~25m by an independent lookup.
  54.599499, -5.951222, true,
  -- 1200m, matching the other Conway Mill partner. West Belfast is not the city
  -- centre and the nearest spot we hold is 276m away at Twin Spires; a 800m
  -- default would draw a map with almost nothing on it.
  1200, false,
  17, true,
  E'FREE PLACEMENT — friends of Marty, added at his request 21 Aug 2026. price_pence deliberately null so it is never counted as advertising revenue.\n'
    || E'WEBSITE LINK STILL NEEDED. Marty asked for it; Instagram is egress-blocked here so the "Link in Bio" URL could not be read, and no plausible domain resolved through the proxy. Add it as the FIRST entry in links and set link_url to match.\n'
    || E'LOGO AND PRODUCT PHOTOS STILL NEEDED. Marty said he would grab the logo and a few product shots. Drop them in public/bfast/ and set logo_url + photo_urls to https://parkeasy.uk/bfast/... — do NOT set them before the assets are deployed, which is how Jack Daniels ended up showing a broken-image icon for two days.\n'
    || E'PARKING GAP: Marty reports street parking all around Conway Mill and parking inside the mill itself. Neither is in the spot dataset — the nearest thing we hold is the Twin Spires hub 276m away. Restrictions unknown, so nothing was invented; ask him what the Conway Street rules are and add it.\n'
    || E'FIGHTER TITLES VERIFIED 21 Aug 2026 against wbcmuaythai.com, belfastmedia.com and irishnews.com. Both men are WBC Muay Thai world champions — McGreevy at welterweight, Smylie at super-welterweight. Do not soften these to "top fighters"; do not inflate them either.\n'
    || E'LANGKA MUAY THAI is the gym both fighters are based out of, also in Conway Mill. Marty is adding it once he has photos — a separate row when that happens.'
)
on conflict (slug) do update set
  name         = excluded.name,
  tagline      = excluded.tagline,
  description  = excluded.description,
  link_url     = excluded.link_url,
  links        = excluded.links,
  address      = excluded.address,
  postcode     = excluded.postcode,
  lat          = excluded.lat,
  lng          = excluded.lng,
  geo_verified = excluded.geo_verified,
  radius_m     = excluded.radius_m,
  is_online    = excluded.is_online,
  priority     = excluded.priority,
  active       = excluded.active,
  notes        = excluded.notes;

-- The order after this file, top to bottom:
--   Tara Lodge 20 · APCOA 19 · SBG Maeda 18 · BFAST 17 ·
--   Sandy McDermott 16 · Jack Daniels 14 · The Red Devil 12 ·
--   Paul's Barbers 11 · Aaron Quinn Hair 10 · Marcus Donnelly 8 ·
--   Gransha Grill 6
--
-- ELEVEN PARTNERS NEEDS ELEVEN SLOTS. On the landing screen the top partner
-- gets the featured block and the rest are interleaved through the results;
-- during a SEARCH there is no featured block, so every partner needs an
-- interleaved slot. restPartners is sliced to PARTNER_SLOTS.length, so an
-- eleventh partner with ten slots simply does not render — no error, no
-- warning, the last one is gone. It has happened at four, five, six, seven,
-- eight and ten. PARTNER_SLOTS gains an eleventh at 49 in the same change, and
-- the page size now DERIVES from the last slot so the two can never drift
-- apart again.
