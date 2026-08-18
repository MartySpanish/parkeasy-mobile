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
// promotion for a competitor.
//
// The first version kept them on every event, collapsed, on the argument that
// a driver at a sold-out venue needs them. Measured against the real data,
// that argument was hypothetical: across 37 events and 528 spots, 28 events
// surfaced an operator car park and ZERO of them would have been left with
// nothing if it were removed — every single one also had a free, community or
// premium spot inside the same radius. So the safety net was paying for
// itself 0 times out of 28 and advertising a competitor the other 28.
//
// Tier 4 is now a genuine LAST RESORT: it appears only when we have nothing
// else at all within walking distance. Today that is no events. It is kept
// rather than deleted because the radius is tunable and new venues get added
// — the day one of them has only an NCP beside it, sending a driver away with
// an empty page would be a worse outcome than naming it.

/** Operators whose car parks we take no commission on. */
const THIRD_PARTY = /\b(NCP|Q-?Park|APCOA|Euro ?Car ?Parks|Smart ?Parking)\b/i;

export const TIER = {
  BOOKABLE: 1,      // our hosts — 15% commission
  PREMIUM_GEM: 2,   // behind the paywall — drives subscriptions
  COMMUNITY: 3,     // free spots people come here for
  PARTNER: 4,       // operators we have a deal with — paid, but ours
  THIRD_PARTY: 5,   // operator car parks we earn nothing from
};

// PARTNER sits BELOW the free spots on purpose. A £4.70/hr multi-storey is not
// a better answer for a driver than a free bay two streets away, and the free
// spots are what this app ranks #1 for. Being a partner earns a promotion out
// of "other car parks nearby" — it does not buy the top of the list.
export const TIER_LABEL = {
  1: 'Book & reserve',
  2: 'Premium picks',
  3: 'Free & community spots',
  4: 'Partner car parks',
  5: 'Other car parks nearby',
};

/**
 * Which tier a spot belongs to. `isGated` comes from the app.
 *
 * Tier 2 is "everything behind the paywall", not "everything badged
 * hidden_gem". The first version tested the badge, which quietly dropped the
 * gated ⚡ EV picks into the free tier — they showed as locked cards under
 * "Free & community spots", which reads as a bug and buries the exact thing
 * the tier exists to sell. isGated already encodes the whole rule, including
 * the five free taster gems and community submissions that must never lock.
 */
export function tierOf(spot, isGated) {
  if (spot.rental && spot.listing) return TIER.BOOKABLE;
  if (isGated?.(spot)) return TIER.PREMIUM_GEM;
  // A PARTNER IS NOT A THIRD PARTY.
  //
  // The regex below demotes operator car parks on the reasoning in TIER's own
  // comment: "operator car parks we earn nothing from". That reasoning stopped
  // being true for APCOA the day a commercial partnership was agreed, and the
  // rule was still sorting them beneath every free spot on the map — ranking a
  // partner as a competitor because their name matched a pattern written
  // before the deal existed.
  //
  // The flag beats the name, in both directions: a partner is never demoted by
  // the regex, and a non-partner operator still is, however it is spelled.
  if (spot.partner) return TIER.PARTNER;
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
    let items = near.filter(x => x.tier === tier).sort((a, b) => a.d - b.d);
    // Operator car parks are listed by name only, so two records for the same
    // site collapse into a visible duplicate — "Q-Park Victoria Square" twice,
    // once as the car park and once as the EV charger inside it. Keep the
    // nearest of each name; the list is already sorted, so the first wins.
    if (tier === TIER.THIRD_PARTY) {
      // Last resort only — if anything of ours is in range, the operator car
      // parks are not shown at all. See the note at the top of the file for
      // the measurement behind this.
      if (groups.length) continue;
      const seen = new Set();
      items = items.filter(x => {
        const k = (x.spot.name || '').toLowerCase();
        return seen.has(k) ? false : (seen.add(k), true);
      });
    }
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
