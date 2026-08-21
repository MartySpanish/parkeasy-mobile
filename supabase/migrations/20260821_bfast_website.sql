-- BFAST: the shop link, and two corrections to what the row said about parking.
--
-- ── THE WEBSITE ─────────────────────────────────────────────────────────────
-- 20260821_bfast_partner.sql shipped with Instagram only, because Instagram is
-- egress-blocked from the build environment and their bio just says "Link in
-- Bio". Marty sent it: https://www.bfastofficial.com — and with a screenshot of
-- the shop open on it, showing the Birthday Cake and Moon Rock tees at £34.99
-- and £35.00 and the Muay Thai shorts at £44.99. That is the URL verified from
-- a browser rather than guessed at, which is the whole reason it was left out
-- the first time.
--
-- It goes FIRST in links, so it becomes the primary button. Somebody who taps a
-- fightwear brand's card wants the shop; Instagram stays as the second link for
-- the drops, which is what he actually asked for.
--
-- ── AND A CORRECTION THE ROW WAS CARRYING ───────────────────────────────────
-- The notes said the Conway Street parking was not in the spot dataset and the
-- nearest thing we held was Twin Spires, 276m away. BOTH WRONG. Spot 305,
-- "Conway Mill car park", has sat on this exact coordinate since 17 August —
-- Marty reported it himself — and its notes already mentioned the on-street
-- parking. It was missed because the proximity check that produced that note
-- scanned src/extraSpots.js and src/evSpots.js and not the CITY_SPOTS arrays in
-- App.jsx, which is where most of Belfast actually lives.
--
-- Worth leaving written down rather than quietly deleting: a partner page is
-- only as good as the parking it can show, and "there is nothing near here" is
-- a claim that needs the whole dataset checked, not two files of it.
--
-- Marty's two photos of the street bays went into spot 305 in the same change:
-- restriction sharpened to "no restrictions signed", the on-street bays moved
-- to the front of the notes, and an estimate of about fifteen of them.
update public.partners set
  link_url = 'https://www.bfastofficial.com',
  links = '[{"label":"Shop BFAST","url":"https://www.bfastofficial.com"},
             {"label":"Follow on Instagram","url":"https://www.instagram.com/bfastofficial/"}]'::jsonb,
  notes = E'FREE PLACEMENT — friends of Marty, added at his request 21 Aug 2026. price_pence deliberately null so it is never counted as advertising revenue.\n'
    || E'WEBSITE ADDED 21 Aug 2026: https://www.bfastofficial.com, sent by Marty with a screenshot of the shop open on it. First in links, so it is the primary button; Instagram is second.\n'
    || E'LOGO AND PRODUCT PHOTOS STILL NEEDED. Marty said he would grab the logo and a few product shots. Drop them in public/bfast/ and set logo_url + photo_urls to https://parkeasy.uk/bfast/... — do NOT set them before the assets are deployed, which is how Jack Daniels ended up showing a broken-image icon for two days.\n'
    || E'PARKING IS COVERED, and an earlier version of this note said it was not. Spot 305 sits on this exact coordinate and covers both the Mill car park and the on-street bays on Conway Street; Marty photographed the street bays on 21 Aug and they are now the first thing its notes describe. The earlier claim came from a proximity check that only scanned extraSpots.js and evSpots.js, missing the CITY_SPOTS arrays in App.jsx.\n'
    || E'FIGHTER TITLES VERIFIED 21 Aug 2026 against wbcmuaythai.com, belfastmedia.com and irishnews.com. Both men are WBC Muay Thai world champions — McGreevy at welterweight, Smylie at super-welterweight. Do not soften these to "top fighters"; do not inflate them either.\n'
    || E'LANGKA MUAY THAI is the gym both fighters are based out of, also in Conway Mill. Marty is adding it once he has photos — a separate row when that happens.'
where slug = 'bfast';
