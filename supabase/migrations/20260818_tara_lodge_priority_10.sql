-- Tara Lodge back to the top of the featured partners. 18 Aug 2026.
--
-- 20260817_partner_order_tara_top.sql set her to 10. She is showing at 4.
--
-- WHY IT MOVED. api/admin.js "Apply pending partner rows" upserts her whole
-- row with on_conflict merge-duplicates, and its payload hardcoded priority 4
-- — the number chosen before the ordering decision was made. Tapping Apply
-- after the reorder therefore reverted it, dropping her below Sandy at 8, and
-- the home screen's featured-partner block quietly featured the wrong
-- business. The payload now says 10, so this cannot recur; this file fixes the
-- row for anyone who would rather run SQL than tap the button.
--
-- Either one is enough. Both are idempotent.
update partners set priority = 10 where slug = 'tara-lodge';

-- Expect Tara Lodge first, then Sandy 8, SBG 7, Jack 6, Red Devil 4,
-- Gransha 3, Marcus -1.
select slug, name, priority from partners order by priority desc, slug;
