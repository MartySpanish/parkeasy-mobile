-- Featured partner order, set by Marty. 18 Aug 2026.
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
-- Gaps of two so a ninth partner can be slotted anywhere without renumbering
-- the list, which is what forces these files to be rewritten each time.
--
-- ── WHY EVERY VALUE IS DISTINCT, AND HAS TO BE ───────────────────────────
-- Ties are broken by distance from the city centre, and Sandy and SBG Maeda
-- share a coordinate to seven decimal places — they are the same building,
-- Joy's Entry. If those two ever tie on priority their order is whatever
-- Postgres happens to return and can change between requests. Marty has asked
-- for SBG above Sandy; only a distinct number can hold that.
--
-- Marcus is is_online with a Belfast-centre placeholder coordinate. He sat at
-- -1 precisely so a fake distance could never rank him. Distinct priorities
-- make distance irrelevant for everyone, so a positive number is safe now.
update partners set priority = 20 where slug = 'tara-lodge';
update partners set priority = 18 where slug = 'sbg-maeda-belfast';
update partners set priority = 16 where slug = 'sandy-mcdermott-sc';
update partners set priority = 14 where slug = 'jack-daniels-fitness';
update partners set priority = 12 where slug = 'the-red-devil';
update partners set priority = 10 where slug = 'aaron-quinn-hair';
update partners set priority =  8 where slug = 'marcus-donnelly-fitness';
update partners set priority =  6 where slug = 'gransha-grill';

-- Expect exactly the eight above, in that order.
select row_number() over (order by priority desc) as pos, name, priority
from partners where active order by priority desc;
