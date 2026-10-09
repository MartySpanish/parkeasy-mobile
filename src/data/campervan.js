// Can a campervan actually use this spot — derived from the data, never guessed.
//
// WHY THIS IS A CLASSIFIER AND NOT A NEW LIST OF SPOTS. Nothing in this
// repository knows where a motorhome may legally stay overnight in Northern
// Ireland, and inventing that is the most harmful thing this app could do: the
// cost of being wrong is not a wasted journey, it is a 3am knock on the window,
// a £100 notice, or a van towed off a private beach car park. So this file adds
// no locations. It reads what the existing 787 spots ALREADY say about
// themselves and surfaces it.
//
// WHAT THE DATA ACTUALLY CONTAINS, which is the whole reason this is worth
// building:
//
//   TWO REAL MOTORHOME FACILITIES, already in the dataset and unfindable:
//     · Sandhill Drive Motorhome & Overflow Area   (Portrush)
//     · Harbour Car Park (Motorhome Aire)          (Carrickfergus)
//   SEVENTEEN-ODD HEIGHT BARRIERS, most of them 1.9–2.2m, which physically
//   exclude every campervan — and the app showed them to everybody with no
//   warning at all.
//   THREE EXPLICIT EXCLUSIONS in the spots' own words:
//     · Glen Road Car Park — "vans and campervans cannot use it"
//     · Old Head Beach     — "height barrier at entrance (no campervans)"
//     · Silverstrand Beach — "height barrier keeps vans out"
//   FOUR EXPLICIT OVERNIGHT BANS.
//
// So the useful feature is not a category we fill in. It is making the two real
// ones findable and the impossible ones say so.
//
// OVERNIGHT IS NEVER 'yes'. Not once, anywhere. An "Aire" strongly implies it
// and the word is quoted on the card so a driver can judge, but nothing in this
// dataset is a permission to sleep somewhere, and a parking app that implies one
// is making a promise a council can overturn with a sign.

/**
 * Heights outside this range are parse artefacts, not barriers.
 *
 * Ocean Terminal's row in the dataset contains BOTH "2.10m height limit" and a
 * mis-typed "10m height limit". A naive parser reads the second one and
 * cheerfully reports a multi-storey as campervan-friendly, which is the exact
 * failure this range exists to stop. Nothing real is a 10m barrier and nothing
 * real is a 0.4m one.
 */
export const BARRIER_MIN_M = 1.5;
export const BARRIER_MAX_M = 4.5;

/**
 * The shortest campervan worth planning for, and the tallest common one.
 *
 * A VW Transporter with the pop-top down is about 2.0m and will go almost
 * anywhere; with the roof up it is around 2.6m. A low-profile motorhome is
 * roughly 2.6–2.9m and a coachbuilt with an overcab bed 3.0–3.2m. So:
 *
 *   barrier < 2.6m   excludes essentially every campervan → 'no'
 *   2.6m–3.2m        excludes some and not others → 'tight', and the NUMBER is
 *                    shown so the driver decides, because only they know what
 *                    they are driving
 *   above 3.2m       not an objection on height
 *
 * These two numbers are the only estimates in this file and they are here,
 * named, rather than buried in a comparison.
 */
export const CAMPERVAN_MIN_M = 2.6;
export const CAMPERVAN_MAX_M = 3.2;

const textOf = (s) =>
  [s?.name, s?.near, s?.notes, s?.restriction].filter(Boolean).join(' · ');

/** The spot's own words, so a card can quote rather than paraphrase. */
const sentenceWith = (text, re) => {
  const m = text.match(new RegExp(`[^·.]*${re.source}[^·.]*`, re.flags.replace('g', '')));
  return m ? m[0].trim() : '';
};

/**
 * A barrier height in metres, or null.
 *
 * Matches both orders — "2.1m height limit" and "height limit 2.1m" — because
 * the dataset is hand-written and contains both. Returns the LOWEST plausible
 * figure found: a row naming two heights is naming a barrier and something
 * else, and the lower one is the one the van has to get under.
 */
export function barrierHeightM(spot) {
  const text = textOf(spot);
  const found = [];
  const push = (v) => {
    const n = Number(v);
    if (Number.isFinite(n) && n >= BARRIER_MIN_M && n <= BARRIER_MAX_M) found.push(n);
  };
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s*m\b[^.·]{0,40}?(?:height|barrier)/gi)) push(m[1]);
  for (const m of text.matchAll(/(?:height|barrier)[^.·]{0,40}?(\d+(?:\.\d+)?)\s*m\b/gi)) push(m[1]);
  return found.length ? Math.min(...found) : null;
}

/** Said outright, in the spot's own words: not for campervans. */
const EXCLUDED = /no campervans?|campervans? cannot|no motorhomes?|motorhomes? cannot|keeps vans out|no vans|unsuitable for (?:camper|motor)/i;

/** A recognised motorhome facility. NAME only — see the note below. */
const DESIGNATED = /motorhome|motor home|\baire\b/i;

/** An explicit ban on staying the night. */
const NO_OVERNIGHT = /no overnight|no sleeping|no camping|overnight parking is not|no park-?and-?travel/i;

/**
 * What we can honestly say about this spot and a campervan.
 *
 * `fits`:
 *   'no'      we know it will not work — said outright, or a barrier under 2.6m
 *   'tight'   a barrier between 2.6m and 3.2m: depends on the van, number given
 *   'yes'     a designated motorhome aire or area
 *   'unknown' we do not know, which is nearly every spot and is not a defect
 *
 * ORDER MATTERS AND PHYSICS WINS. The exclusion and height checks run BEFORE
 * the designation check, so a row calling itself an aire while also naming a
 * 2m barrier comes out 'no'. A label cannot raise a barrier.
 *
 * `overnight` is only ever 'no' or 'unknown'. See the header.
 */
export function classifyCampervan(spot) {
  if (!spot || typeof spot !== 'object') {
    return { fits: 'unknown', heightM: null, overnight: 'unknown', note: '' };
  }
  const text = textOf(spot);
  const heightM = barrierHeightM(spot);
  const overnight = NO_OVERNIGHT.test(text) ? 'no' : 'unknown';

  if (EXCLUDED.test(text)) {
    return { fits: 'no', heightM, overnight, note: sentenceWith(text, EXCLUDED) };
  }
  if (heightM != null && heightM < CAMPERVAN_MIN_M) {
    return { fits: 'no', heightM, overnight, note: `${heightM}m height barrier` };
  }
  if (heightM != null && heightM <= CAMPERVAN_MAX_M) {
    return { fits: 'tight', heightM, overnight, note: `${heightM}m height barrier` };
  }
  // DESIGNATION IS READ FROM THE NAME, NOT THE NOTES, and deliberately.
  // "Keel Beach (Sandybanks) car park" mentions a Caravan & Camping Park in its
  // notes only to say it is PRIVATE — patrons only. Matching on notes would
  // turn that warning into a recommendation. A caravan or holiday park is also
  // not matched at all: it is a campsite somebody else owns, not a car park a
  // campervan may use.
  if (DESIGNATED.test(String(spot.name || ''))) {
    return { fits: 'yes', heightM, overnight, note: String(spot.name) };
  }
  return { fits: 'unknown', heightM, overnight, note: '' };
}

/** The filter: only spots we can actually stand behind for a campervan. */
export const isCampervanSpot = (spot) => classifyCampervan(spot).fits === 'yes';

/** Is there anything a campervan driver needs warning about? */
export const hasCampervanWarning = (spot) => {
  const c = classifyCampervan(spot);
  return c.fits === 'no' || c.fits === 'tight' || c.overnight === 'no';
};

/**
 * The chip filter: spots a campervan driver can usefully be shown.
 *
 * 'yes' AND 'tight', never 'no'. Hiding a 3m-barrier retail park from somebody
 * driving a 2.7m van would be unhelpful in the other direction, and the card
 * prints the actual barrier so they can judge. What the filter must never do is
 * offer a 1.9m multi-storey.
 */
export const isCampervanCandidate = (spot) => {
  const f = classifyCampervan(spot).fits;
  return f === 'yes' || f === 'tight';
};
