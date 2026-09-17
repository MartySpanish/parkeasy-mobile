// Is this spot in Northern Ireland?
//
// WHY THIS EXISTS. The homepage said "744 parking spots across Northern
// Ireland". Ninety of them are not in Northern Ireland: Dublin, Cork, Galway,
// Manchester, Glasgow, Edinburgh and Perth, from the pilot and APCOA datasets.
// The hidden gems had the same problem in reverse — 133 published, 28 of them
// in the Republic.
//
// Four separate places print those numbers (the prerendered SEO text, the
// three meta descriptions, the globe card, and the hero) and each was counting
// differently. One rule, in one file, used by the build script AND the app, is
// the only way they cannot drift apart again.
//
// THE RULE, and its honest limit. A bounding box round Northern Ireland is
// mostly right and wrong in one specific way: County Donegal sticks up ABOVE
// most of Northern Ireland, so Malin Head and Dunfanaghy sit inside any box you
// would draw. That is why `region` wins whenever a spot has one — hidden gems
// carry it from the database, where classification is an explicit town list
// rather than geometry (see 20260902_gem_region.sql).
//
// The box is only the fallback, for the bundled spots that have no region
// column. It is safe for those because every non-NI bundled spot is in a city
// that is nowhere near the border — the nearest is Dublin, 140 km south. If a
// Donegal pilot site is ever added, it needs a region, not a bigger box.
const NI_BOX = { latMin: 54.0, latMax: 55.4, lngMin: -8.2, lngMax: -5.4 };

/** Cities in the bundled datasets that are NOT in Northern Ireland. */
export const NON_NI_CITIES = new Set([
  'dublin', 'cork', 'galway',              // Republic of Ireland
  'manchester', 'glasgow', 'edinburgh', 'perth',  // Britain
]);

/**
 * @param spot needs lat/lng; `region` ('NI' | 'ROI') and `_city` are used when present.
 * @returns true only when the spot is positively in Northern Ireland.
 *
 * Anything unplaceable returns FALSE, so it drops out of the count rather than
 * inflating it. Understating is the safe direction: a number that is too low
 * costs nothing, and a number that is too high is the one a stranger can
 * disprove in a single tap.
 */
export const inNorthernIreland = (spot) => {
  if (!spot) return false;

  // An explicit region always wins — it is a fact on the row, not a guess.
  if (spot.region === 'NI') return true;
  if (spot.region === 'ROI') return false;

  // A known non-NI city wins over the box, so a dataset that gains a Donegal
  // or a Dundalk is excluded by name rather than being caught by geometry.
  const city = String(spot._city || spot.town || '').toLowerCase().trim();
  if (NON_NI_CITIES.has(city)) return false;

  const { lat, lng } = spot;
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  return lat > NI_BOX.latMin && lat < NI_BOX.latMax
      && lng > NI_BOX.lngMin && lng < NI_BOX.lngMax;
};

export const NI_BOUNDS = NI_BOX;
