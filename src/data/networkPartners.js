// A partner that is a PARKING NETWORK rather than a shop.
//
// Every featured partner until now has been a single premises — a barber, a
// gym, a chippy, a hotel. The card and the business page are both built on
// that assumption, and both do the same useful thing with it: draw a map of
// the free spots around the front door, so an advert turns into "here is where
// to leave the car for this place".
//
// APCOA breaks that assumption twice.
//
//   1. It has no front door. It runs car parks in Belfast, Newry and Craigavon,
//      and the nearness test that decides whether a partner shows in a town
//      would measure the distance to whichever single pin we happened to store.
//      Pinned at Lanyon Place, APCOA would be invisible in Newry — a town where
//      it actually operates.
//
//   2. "Free spots near its door" is the WRONG list. Drawing the free kerbside
//      around an APCOA barrier lists the alternatives to the partner, on the
//      partner's own page. What a driver wants from APCOA is APCOA's car parks.
//
// So a network partner swaps both: its distance is the distance to its NEAREST
// site, and the list under its name is its OWN sites. Everything else — the
// card, the impression tracking, the priority order — is unchanged, because
// nothing else about it is different.
//
// Keyed by partners.slug and deliberately in code rather than a column: it is
// one row today, the reasoning belongs beside the rule, and a partner missing
// from this map simply behaves like a normal local business.

export const NETWORK_PARTNERS = {
  apcoa: {
    // NOT "Featured local business". APCOA is a European operator with car
    // parks in three Northern Irish towns; calling it local would be the kind
    // of small untruth nobody notices and everybody eventually catches.
    eyebrow: 'Featured parking partner',
    cardLink: 'See APCOA car parks',
    heading: 'APCOA car parks on ParkEasy',
    // Their sites are already in the app as ordinary spots (src/apcoaSpots.js),
    // flagged when they were added. Matching on the flags rather than listing
    // ids means a new APCOA site added there appears here for free.
    //
    // BOTH FLAGS, NOT JUST is_apcoa. There are 21 more APCOA car parks in
    // src/pilotSpots.js — Dublin, Cork, Galway, Manchester, Glasgow — added by
    // a research sweep and carrying partner:false, because the agreement covers
    // the Northern Irish sites and nothing else. On is_apcoa alone this page
    // listed Buchanan Galleries and Manchester Arndale under a Belfast
    // partner's name, and the map centred on the mean of the lot, which is the
    // middle of the Irish Sea. partner:true is the line the data already draws
    // between "we have a deal here" and "we know this car park exists"; a
    // partner page has no business crossing it.
    match: (s) => s?.is_apcoa === true && s?.partner === true,
    // WHAT THIS CARD MUST NOT SAY. The Heads of Terms is a DRAFT dated 17
    // August 2026, marked "subject to contract, not legally binding", and has
    // not come back signed. The two Belfast rental_listings are still
    // status='draft' with no agreed price and no Stripe account, and the
    // discounted booking link has not arrived. So: no "bookable", no
    // "discount", no "ParkEasy rate". Their own public barrier tariffs, shown
    // as information, exactly as they already are on the spot cards.
    note: 'Prices are APCOA’s own published tariffs. You pay APCOA directly, at the barrier or in the APCOA Connect app — these are not ParkEasy bookings.',
  },
};

/** The network config for a partner row, or null for an ordinary business. */
export const networkPartner = (p) => (p && NETWORK_PARTNERS[p.slug]) || null;

/** Every spot belonging to this network, nearest first when a point is given. */
export function networkSites(np, spots, lat, lng) {
  const sites = (spots || []).filter(s => np?.match?.(s));
  if (typeof lat !== 'number' || typeof lng !== 'number') return sites;
  return sites
    .map(s => ({ s, d: Math.hypot((s.lat - lat) * 111320, (s.lng - lng) * 65000) }))
    .sort((a, b) => a.d - b.d)
    .map(x => x.s);
}

/**
 * Distance from a point to the network's NEAREST site, in metres.
 *
 * This is what replaces "distance to the partner's pin" for a network, and it
 * is the whole reason APCOA shows up in Newry as well as Belfast. Infinity when
 * the network has no sites at all, so a misconfigured row fails by being
 * hidden rather than by claiming to be next door.
 */
export function nearestSiteDistance(np, spots, lat, lng) {
  let best = Infinity;
  for (const s of spots || []) {
    if (!np?.match?.(s)) continue;
    const d = Math.hypot((s.lat - lat) * 111320, (s.lng - lng) * 65000);
    if (d < best) best = d;
  }
  return best;
}

export default networkPartner;
