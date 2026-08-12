-- Sandy's copy, and a deterministic partner order. APPLIED 12 Aug 2026.
--
-- Supersedes 20260812_sandy_name.sql and 20260812_partner_order.sql, both of
-- which were written while the Supabase connector was down and never ran. This
-- file is what is actually in the database. All three are idempotent, so
-- running any of them again is harmless.
--
-- ── 1. THE LITERAL \n BUG ──────────────────────────────────────────────────
-- The original insert wrote the description as a standard SQL string, where
-- \n is just a backslash followed by an n. So the page rendered
--     "...just lift in.\n\nSandy is UKSCA accredited..."
-- with the escape sequence visible in the middle of the paragraph. E'' makes
-- Postgres interpret the escapes. The card already carries whitespace-pre-line,
-- so real newlines become real paragraph breaks with no code change needed.
--
-- Wording tightened at the same time.
update partners set
  name = 'Sandy McDermott Strength and Conditioning',
  tagline = 'UKSCA-accredited strength and conditioning in Belfast — 6am classes, athlete programming and sport nutrition.',
  description = E'A proper strength and conditioning gym rather than a circuit class in a hall. Rigs, bars and bumpers down one side, assault bikes and plyo boxes down the other, and a full sprint track through the middle — a floor you can run and jump on, not just lift on.\n\nSandy is UKSCA accredited with an MSc in Sport Nutrition, so the programming is built the way it is for a reason: strength, speed and conditioning that carry onto a pitch, with nutrition behind it rather than guesswork.\n\nGroup sessions run at 6am Monday to Friday, alongside one-to-one athlete work and team blocks. GAA, football, rugby or none of the above — sessions are scaled to whoever turns up.'
where slug = 'sandy-mcdermott-sc';

-- ── 2. ORDER BY INTENT, NOT BY ACCIDENT ───────────────────────────────────
-- Featured partners sort by priority, then by distance from the city centre.
-- Every partner but The Red Devil sat at priority 0, which made that group's
-- order an accident twice over:
--
--   * Sandy and SBG Maeda share a coordinate to seven decimal places — they are
--     the same building — so distance cannot break the tie. Their order was
--     whatever Postgres happened to return, and could change between requests.
--   * Marcus Donnelly Fitness is an ONLINE business whose lat/lng are the
--     Belfast-centre placeholder the NOT NULL columns demand. It measured 0m
--     from the centre and beat every real business in the list.
--
-- Explicit priorities, with gaps so a future partner can be slotted between
-- two existing ones without renumbering everything:
--
--   10  The Red Devil
--    6  Sandy McDermott Strength and Conditioning
--    5  SBG Maeda Belfast
--    3  Gransha Grill
--   -1  Marcus Donnelly Fitness   (online — never ranked on a fake distance)
--
-- All five still appear: PARTNER_SLOTS has five positions, so this decides
-- placement, not visibility.
update partners set priority = 10 where slug = 'the-red-devil';
update partners set priority =  6 where slug = 'sandy-mcdermott-sc';
update partners set priority =  5 where slug = 'sbg-maeda-belfast';
update partners set priority =  3 where slug = 'gransha-grill';
update partners set priority = -1 where slug = 'marcus-donnelly-fitness';

-- ── NOT CHANGED HERE, BUT NOTE ────────────────────────────────────────────
-- The Red Devil's placement carries ends_at = 2026-08-10 01:00Z. That has
-- passed, and nothing enforces it: the client query fetches neither starts_at
-- nor ends_at, and filters on distance alone. So an expired placement keeps
-- running, and after this migration it runs in first place.
--
-- Deliberately left alone — taking a real business off the app is a commercial
-- call, not a tidy-up. Two ways to settle it: extend ends_at if the placement
-- was renewed, or start honouring the window in the query, which would drop
-- The Red Devil the moment it ships.
