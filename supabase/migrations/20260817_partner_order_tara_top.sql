-- Partner order, reset by Marty. APPLIED 17 Aug 2026.
--
-- Tara Lodge to the top, the three gyms as a block behind her, Gransha Grill
-- left low. Supersedes the priorities in 20260812_partner_copy_and_order.sql.
--
--   10  Tara Lodge
--    8  Sandy McDermott Strength and Conditioning
--    7  SBG Maeda Belfast
--    6  Jack Daniels Fitness
--    4  The Red Devil
--    3  Gransha Grill
--   -1  Marcus Donnelly Fitness   (online — never ranked on a placeholder pin)
--
-- ── THE PART WORTH RECORDING ──────────────────────────────────────────────
-- This DEMOTES The Red Devil from first to fifth, and it is the only partner
-- that has ever been a paid placement — every other row is a free listing. It
-- was flagged as exactly that before the change and Marty chose it anyway,
-- which is his call to make. Written down because "why is the paying partner
-- fifth" is a question somebody will ask later, and the answer should not have
-- to be reconstructed.
--
-- ── AND THE TIE IT FIXES ──────────────────────────────────────────────────
-- Tara Lodge went in at priority 4, chosen on the assumption that Jack Daniels
-- sat at 2. He was also at 4, so the two of them tied and their order fell to
-- distance from the city centre — Tara 1059m, Jack 1395m. Deterministic, since
-- they have different coordinates, so it was never the coin-flip that Sandy
-- and SBG hit sharing one address. But it was decided by geography rather than
-- by intent, which is the thing 20260812_partner_copy_and_order.sql set out to
-- stop. Every priority here is distinct, so distance now breaks nothing.
--
-- Gaps left between the numbers so a future partner can be slotted in without
-- renumbering the whole list.

update partners set priority = 10 where slug = 'tara-lodge';
update partners set priority =  8 where slug = 'sandy-mcdermott-sc';
update partners set priority =  7 where slug = 'sbg-maeda-belfast';
update partners set priority =  6 where slug = 'jack-daniels-fitness';
update partners set priority =  4 where slug = 'the-red-devil';
update partners set priority =  3 where slug = 'gransha-grill';
update partners set priority = -1 where slug = 'marcus-donnelly-fitness';
