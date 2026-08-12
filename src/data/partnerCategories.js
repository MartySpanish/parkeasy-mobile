// Which home category each featured partner belongs to.
//
// WHY. Tap "Gyms & Wellbeing" and the gyms we are paid to feature should be
// the first thing on the page — not buried at result 3, 10 and 18 between
// council leisure centres. A category tap is the clearest statement of intent
// a driver ever gives us, and it is the one moment a relevant advert stops
// being an advert and becomes the answer to the question they just asked.
//
// Everyone else keeps their normal interleaved slots, so leading one category
// never costs an unrelated partner its placement.
//
// DELIBERATELY IN CODE, not a partners column. It is five hand-curated rows,
// it needs no migration, and it means this reasoning sits beside the data.
// A partner missing from this map simply never leads a category — forgetting
// to tag one costs a placement, never a disappearance.
//
// Category ids must match CATEGORIES in components/home/CategoryGrid.jsx.
export const PARTNER_CATEGORIES = {
  'sandy-mcdermott-sc':      ['fitness'],
  'sbg-maeda-belfast':       ['fitness'],
  'marcus-donnelly-fitness': ['fitness'],
  'gransha-grill':           ['brunch'],
  'the-red-devil':           ['nightout'],
};

/**
 * Split partners into the ones that lead a category and the ones that don't.
 *
 * Lives here, exported and pure, so it can be tested without a database. The
 * component that uses it cannot render at all without Supabase credentials,
 * and "the same partner appears twice on one page" is exactly the bug that
 * would otherwise reach production unnoticed.
 *
 * Order is preserved within both groups, so the priority-then-distance sort
 * already applied to the list still decides placement.
 *
 * @param partners  partners for the current city, already sorted
 * @param catId     the active category id, or null when none is showing
 * @returns [leadPartners, restPartners]
 */
export function splitPartnersByCategory(partners, catId) {
  if (!catId) return [[], partners || []];
  const lead = [], rest = [];
  for (const p of partners || []) {
    ((PARTNER_CATEGORIES[p.slug] || []).includes(catId) ? lead : rest).push(p);
  }
  return [lead, rest];
}

export default splitPartnersByCategory;
