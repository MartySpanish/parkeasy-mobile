// How parking is ranked on an event page.
//
// The commercial brief: lead with what earns, stop giving free advertising to
// operators we make nothing from. That is implemented as RANKING, not deletion.
//
// Why not deletion. Free community spots are the reason people install this
// app — "the spots locals know" is the whole pitch, and it is what brings the
// audience an event page monetises. Strip them out and the page becomes a
// worse version of every other parking site, run by someone with two car
// parks. So the order below puts money first and keeps the rest underneath,
// where it costs us nothing and still gets somebody parked.
//
// Tier 4 is the one that matters commercially: NCP, Q-Park and APCOA earn us
// exactly nothing, and listing them prominently beside an event is free
// promotion for a competitor. They stay — a driver at a sold-out venue needs
// them — but they go last and they are not badged as recommendations.

/** Operators whose car parks we take no commission on. */
const THIRD_PARTY = /\b(NCP|Q-?Park|APCOA|Euro ?Car ?Parks|Smart ?Parking)\b/i;

export const TIER = {
  BOOKABLE: 1,      // our hosts — 15% commission
  PREMIUM_GEM: 2,   // behind the paywall — drives subscriptions
  COMMUNITY: 3,     // free spots people come here for
  THIRD_PARTY: 4,   // operator car parks we earn nothing from
};

export const TIER_LABEL = {
  1: 'Book & reserve',
  2: 'Premium hidden gems',
  3: 'Free & community spots',
  4: 'Other car parks nearby',
};

/** Which tier a spot belongs to. `isGated` comes from the app. */
export function tierOf(spot, isGated) {
  if (spot.rental && spot.listing) return TIER.BOOKABLE;
  if (spot.badge === 'hidden_gem' && isGated?.(spot)) return TIER.PREMIUM_GEM;
  if (THIRD_PARTY.test(spot.name || '')) return TIER.THIRD_PARTY;
  return TIER.COMMUNITY;
}

const metres = (a, b) =>
  Math.round(Math.hypot((b[0] - a[0]) * 111320, (b[1] - a[1]) * 65000));

/**
 * Parking for one event, grouped by tier and sorted by distance inside each.
 *
 * @param spots    every spot in the network
 * @param venue    { lat, lng }
 * @param isGated  predicate from App.jsx — a gem is only "premium" if the
 *                 viewer cannot already see it
 * @param radiusM  how far a person will realistically walk to a venue
 */
export function parkingForEvent(spots, venue, isGated, radiusM = 1600) {
  if (!venue?.lat) return [];
  const near = (spots || [])
    .map(s => ({ spot: s, d: metres([venue.lat, venue.lng], [s.lat, s.lng]) }))
    .filter(x => x.d <= radiusM)
    .map(x => ({ ...x, tier: tierOf(x.spot, isGated), walkMin: Math.max(1, Math.round(x.d / 80)) }));

  const groups = [];
  for (const tier of [TIER.BOOKABLE, TIER.PREMIUM_GEM, TIER.COMMUNITY, TIER.THIRD_PARTY]) {
    const items = near.filter(x => x.tier === tier).sort((a, b) => a.d - b.d);
    if (items.length) {
      groups.push({
        tier,
        label: TIER_LABEL[tier],
        // Only the tiers we earn from get the full treatment on the page.
        // The rest are a collapsed list — present, not promoted.
        promoted: tier === TIER.BOOKABLE || tier === TIER.PREMIUM_GEM,
        items: tier === TIER.THIRD_PARTY ? items.slice(0, 3) : items.slice(0, 6),
      });
    }
  }
  return groups;
}

export default { parkingForEvent, tierOf, TIER, TIER_LABEL };
