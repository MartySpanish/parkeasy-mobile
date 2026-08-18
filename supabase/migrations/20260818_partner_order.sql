-- Partner order, reset by Marty. 18 Aug 2026.
--
-- Supersedes the priorities in 20260817_partner_order_tara_top.sql.
--
--   20  Tara Lodge
--   18  SBG Maeda Belfast
--   16  Sandy McDermott Strength and Conditioning
--   14  Jack Daniels Fitness
--   12  The Red Devil
--   10  Aaron Quinn Hair
--    8  Marcus Donnelly Fitness
--    6  Gransha Grill
--
-- Four changes against yesterday's order:
--
--   * SBG and Sandy swap. They share one address (54.5993811, -5.9271509),
--     so a tie between them would fall to a distance test that returns the
--     same number for both — the coin flip 20260812_partner_copy_and_order.sql
--     was written to stop. Distinct priorities keep it decided by intent.
--   * Gransha Grill drops from sixth to last.
--   * Aaron Quinn Hair up one, to sixth.
--   * Marcus Donnelly Fitness comes off -1, up to seventh.
--
-- ── MARCUS, AND WHY -1 IS NOT AN ARBITRARY NUMBER ─────────────────────────
-- He sat at -1 since 20260812_partner_order.sql, and that was not a ranking
-- so much as a fix: he is an ONLINE business, his lat/lng are the Belfast
-- centre placeholder the NOT NULL columns demand, and at priority 0 that fake
-- 0m distance won him second place outright. -1 took the placeholder out of
-- the sort entirely.
--
-- Ranking him seventh by intent is safe, because intent is exactly what this
-- column is for and every priority here is distinct — no row falls through to
-- the distance test. What has NOT changed is the geo gate: splitPartnersByCategory
-- excludes partners with geo_verified = false from leading a location search,
-- so the placeholder still cannot make him "nearby". Both guards stay up.
--
-- ── AARON QUINN HAIR HAS THE SAME PLACEHOLDER PIN ─────────────────────────
-- (54.5973, -5.9301), geo_verified = false, identical to Marcus's. Unlike
-- Marcus he is a premises with a real front door, so this is a missing
-- coordinate rather than a business without one. Harmless for ordering — his
-- priority is distinct — but it means he can never lead a nearby search, and
-- his map pin is wrong. Worth getting the real address in.
--
-- Gaps of 2 left between the numbers so a partner can be slotted in without
-- renumbering the list.
--
-- Idempotent, matched on slug, safe to re-run.

update partners set priority = 20 where slug = 'tara-lodge';
update partners set priority = 18 where slug = 'sbg-maeda-belfast';
update partners set priority = 16 where slug = 'sandy-mcdermott-sc';
update partners set priority = 14 where slug = 'jack-daniels-fitness';
update partners set priority = 12 where slug = 'the-red-devil';
update partners set priority = 10 where slug = 'aaron-quinn-hair';
update partners set priority =  8 where slug = 'marcus-donnelly-fitness';
update partners set priority =  6 where slug = 'gransha-grill';
