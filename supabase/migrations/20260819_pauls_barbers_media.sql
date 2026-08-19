-- Paul's Barbers: logo, photos and the socials from his card.
--
-- ⚠️  NOT APPLIED. This is the one file in this directory that has not been
-- run, and it must not be run until the four image files below actually exist
-- in the repo. Pointing a live partner card at URLs that 404 is worse than the
-- blank card he has now — a broken image says "this business is not really
-- here", which is the opposite of what a featured placement is for.
--
-- ── WHY IT IS NOT APPLIED ─────────────────────────────────────────────────
-- Marty sent the logo and three photos in chat. They cannot be written to disk
-- from there — a pasted image is not a file, and this session has no way to
-- turn one into one. Aaron Quinn's four images live in public/aaronquinn/ and
-- got there by being committed to the repo; Paul's need the same route.
--
-- ── WHAT TO DO ────────────────────────────────────────────────────────────
-- 1. Save the four images into public/paulsbarbers/ with exactly these names:
--
--      logo.jpg              the round PB monogram on black
--      1-skin-fade.jpg       high skin fade, textured top, full beard
--      2-textured-crop.jpg   textured crop with a fringe, beard blended in
--      3-taper-back.jpg      taper from behind, showing the neckline
--
--    Same shape as public/aaronquinn/, so the two partners stay consistent and
--    nobody has to guess the convention next time.
--
-- 2. Commit them, so they deploy to parkeasy.uk/paulsbarbers/*.
-- 3. THEN run this file.
--
-- The order matters. Run it before step 2 and every card, the map page and the
-- gallery all show broken images until the next deploy.
--
-- ── THE LINKS ─────────────────────────────────────────────────────────────
-- His logo shows a Facebook and an Instagram glyph but names neither account,
-- and guessing a handle sends people to a stranger. So links stays EMPTY here
-- and link_url is left alone. Add them when Paul supplies the real URLs — the
-- card renders fine without, it simply has no "Visit" button.
--
-- Idempotent on slug, safe to re-run once the files are in.

update public.partners set
  logo_url   = 'https://parkeasy.uk/paulsbarbers/logo.jpg',
  photo_url  = 'https://parkeasy.uk/paulsbarbers/1-skin-fade.jpg',
  photo_urls = array[
    'https://parkeasy.uk/paulsbarbers/1-skin-fade.jpg',
    'https://parkeasy.uk/paulsbarbers/2-textured-crop.jpg',
    'https://parkeasy.uk/paulsbarbers/3-taper-back.jpg'
  ]
where slug = 'pauls-barbers';
