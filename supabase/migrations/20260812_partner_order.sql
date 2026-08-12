-- Partner ordering, and Sandy's name. Both pending changes in one file so
-- there is a single thing to run.
--
-- WHY MARCUS WAS SECOND. Featured partners sort by
--     b.priority - a.priority || a.d - b.d
-- and every partner except The Red Devil sits at priority 0, so the order
-- inside that group is decided purely by distance from the city centre.
-- Marcus Donnelly Fitness is an ONLINE business with no premises. Its lat/lng
-- are the Belfast centre placeholder the NOT NULL columns demand — so it
-- measured 0 metres from the centre and won the group outright:
--
--     1. The Red Devil   priority  1   2021m
--     2. Marcus          priority  0      0m   ← a placeholder, not a location
--     3. Sandy           priority  0    301m
--     4. SBG Maeda       priority  0    301m
--     5. Gransha Grill   priority  0   3948m
--
-- Ranking a business by a coordinate that does not mean anything is the same
-- class of mistake as drawing a parking map from one. Marty asked for Marcus
-- after Sandy; the honest fix is to rank him by intent instead of by accident.
-- priority -1 puts him last and takes the fake distance out of it entirely.
--
--     1. The Red Devil   priority  1
--     2. Sandy           priority  0    301m
--     3. SBG Maeda       priority  0    301m
--     4. Gransha Grill   priority  0   3948m
--     5. Marcus          priority -1
--
-- All five still show: PARTNER_SLOTS has five positions, so this decides
-- placement in the list, not whether anyone appears.
--
-- Idempotent, matched on slug, safe to re-run.

update partners
set priority = -1
where slug = 'marcus-donnelly-fitness';

-- Repeated from 20260812_sandy_name.sql, which was written while the Supabase
-- connector was down and may never have been applied. Harmless if it was.
update partners
set name = 'Sandy McDermott Strength and Conditioning'
where slug = 'sandy-mcdermott-sc';
