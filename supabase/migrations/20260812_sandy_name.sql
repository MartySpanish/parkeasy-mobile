-- Sandy McDermott Strength and Conditioning — name spelled out.
--
-- The row went in as "Sandy McDermott Strength & Conditioning", copied from the
-- Instagram bio. Marty wants "and" written out. The name is the one field a
-- business is entitled to have exactly as they say it, so it is worth a
-- migration rather than a quiet edit.
--
-- Title case kept: the instruction was typed lower-case in passing, but this is
-- a business name on a public page, and every other partner in the table is
-- title-cased. Say the word if it should be all lower-case as a styling choice.
--
-- Idempotent: matches on slug, and safe to re-run.

update partners
set name = 'Sandy McDermott Strength and Conditioning'
where slug = 'sandy-mcdermott-sc';
