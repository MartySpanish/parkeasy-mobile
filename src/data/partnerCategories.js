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
// DELIBERATELY IN CODE, not a partners column. It is a handful of curated rows,
// it needs no migration, and it means this reasoning sits beside the data.
// A partner missing from this map simply never leads a category — forgetting
// to tag one costs a placement, never a disappearance.
//
// Category ids must match CATEGORIES in components/home/CategoryGrid.jsx.
export const PARTNER_CATEGORIES = {
  'sandy-mcdermott-sc':      ['fitness'],
  'jack-daniels-fitness':    ['fitness'],
  'sbg-maeda-belfast':       ['fitness'],
  // A fightwear brand AND a gym, in Conway Mill. It earns the fitness tile on
  // the second half of that — somebody tapping "Gyms & Wellbeing" in west
  // Belfast is being shown a real gym, not an advert for shorts.
  'bfast':                   ['fitness'],
  'marcus-donnelly-fitness': ['fitness'],
  'gransha-grill':           ['brunch'],
  'the-red-devil':           ['nightout'],
  // Tara Lodge leads BOTH the tile a visitor taps to find somewhere to stay
  // and the one they tap on a night out — it is a hotel in the Queen's
  // Quarter, five minutes from Botanic and fifteen from the centre, so a
  // driver on either of those errands is a driver it is genuinely useful to.
  'tara-lodge':              ['hotels', 'nightout'],
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
 * @param geo       the searched location {lat,lng}, or null
 * @param radiusM   how near a partner must be to lead on location alone
 * @returns [leadPartners, restPartners]
 */
export function splitPartnersByCategory(partners, catId, geo, radiusM = 1500) {
  if (!catId && !geo) return [[], partners || []];
  const lead = [], nearby = [], rest = [];
  for (const p of partners || []) {
    const byCategory = catId && (PARTNER_CATEGORIES[p.slug] || []).includes(catId);
    // A business two streets from where you just searched is as relevant as
    // one that matches the category you tapped — arguably more so. Straight
    // line, same as everywhere else in the app, and generous at 1.5km because
    // a partner is a suggestion rather than a destination.
    //
    // Partners without a TRUSTED pin are excluded. Their coordinates are the
    // city-centre placeholder the NOT NULL columns demand, so a distance test
    // on them measures nothing — Marcus would otherwise "lead" every
    // city-centre search by sitting exactly on the pin.
    //
    // The test used to be !p.is_online, which was the wrong gate and only
    // looked right because Marcus was the only placeholder in the table.
    // Tara Lodge is a real hotel with a real front door and, until somebody
    // confirms a coordinate for Cromwell Road, the same placeholder — a
    // premises, so is_online is false, and it would have inherited the exact
    // bug that rule was written to kill. geo_verified is the column that
    // actually answers "does this number mean anything", and it is already
    // what gates the parking map and the nearby-spots list. Same question,
    // same answer, everywhere.
    const byPlace = geo && p.geo_verified && typeof p.lat === 'number'
      && Math.hypot((p.lat - geo.lat) * 111320, (p.lng - geo.lng) * 65000) <= radiusM;
    if (byCategory) lead.push(p);
    else if (byPlace) nearby.push(p);
    else rest.push(p);
  }
  // A CATEGORY match beats a PROXIMITY match, always. Tapping "Travel &
  // Hotels" put The Red Devil above Tara Lodge, because both qualified to lead
  // and the group kept the priority order underneath — so a bar that happens
  // to be near the search outranked the hotel the tile is literally about.
  // Being nearby is a reason to show a business; being the thing that was
  // asked for is a reason to show it FIRST.
  return [lead.concat(nearby), rest];
}

export default splitPartnersByCategory;
