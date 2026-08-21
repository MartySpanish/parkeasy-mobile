-- Put BFAST's images on the card.
--
-- ── WHY THIS IS A SEPARATE MIGRATION FROM THE FILES ─────────────────────────
-- The assets landed in public/bfast/ in #241 and #243. This sets the URLs, and
-- it is deliberately NOT in either of those commits.
--
-- Jack Daniels Fitness showed a broken-image icon for two days in August
-- because logo_url was set to a file committed in an unmerged PR: the URL
-- existed, the image did not, and nothing connected the two. So the rule is
-- that the row is only pointed at a file AFTER that file is confirmed to be
-- serving — and this migration was held back until it was.
--
-- VERIFIED BEFORE WRITING, not assumed. parkeasy.uk is blocked by the build
-- environment's egress proxy, so it could not be curled; instead the published
-- branch itself was checked, which is the same fact one step earlier:
--
--   $ git ls-tree -l origin/gh-pages bfast/
--   134763 bfast/1-champions.jpg
--    12936 bfast/2-birthday-cake-tee.jpg
--    13560 bfast/3-moon-rock-tee.jpg
--    20032 bfast/4-moon-rock-shorts.jpg
--    19562 bfast/5-birthday-cake-shorts.jpg
--   135197 bfast/6-shorts-detail.jpg
--    86101 bfast/7-drop-moon-rock-birthday-cake.jpg
--    15004 bfast/logo.png
--
-- Byte-for-byte the files that were committed, on the branch GitHub Pages
-- serves, with the deploy workflow run for #243 green.
--
-- ── ORDER ───────────────────────────────────────────────────────────────────
-- The champions shot leads: it is the brand's own strongest image and it is two
-- world champions wearing the kit, which is the whole reason a driver would
-- care. Products follow, then the worn shots. The number prefixes on the
-- filenames are the order, matching the convention partner_photos_sync() uses
-- for the partner-photos bucket, so the two routes cannot disagree.
--
-- ── ATTRIBUTION ─────────────────────────────────────────────────────────────
-- 6-shorts-detail.jpg is @darraghbarry309's photograph, posted as a collab with
-- BFAST. Held back at first for that reason; Marty confirmed on 21 Aug 2026
-- that Darragh is happy for it to be used. See public/bfast/README.md.
update public.partners set
  logo_url = 'https://parkeasy.uk/bfast/logo.png',
  photo_urls = array[
    'https://parkeasy.uk/bfast/1-champions.jpg',
    'https://parkeasy.uk/bfast/2-birthday-cake-tee.jpg',
    'https://parkeasy.uk/bfast/3-moon-rock-tee.jpg',
    'https://parkeasy.uk/bfast/4-moon-rock-shorts.jpg',
    'https://parkeasy.uk/bfast/5-birthday-cake-shorts.jpg',
    'https://parkeasy.uk/bfast/6-shorts-detail.jpg',
    'https://parkeasy.uk/bfast/7-drop-moon-rock-birthday-cake.jpg'
  ],
  -- photo_url is the single-image fallback for anything reading the old column.
  -- Same picture as the head of the strip, so the two can never disagree.
  photo_url = 'https://parkeasy.uk/bfast/1-champions.jpg'
where slug = 'bfast';
