// What "Recommended" puts first, and why it was putting the wrong thing there.
//
// THE DEFECT. The default sort is `popular`, labelled **Recommended** in the
// UI, and it ranks by `spot.votes`. Those votes are seed weights — the sort's
// own comment in App.jsx says so:
//
//   "`votes` is a weight in the seed data — a couple of thousand of them across
//    297 spots, none given by a driver — so calling this 'Most Popular' claimed
//    a popularity nobody measured."
//
// The label was walked back from "Most Popular" to "Recommended" for that
// reason. What nobody noticed is that every bookable ParkEasy listing is built
// with `votes: 0`, so the one kind of space ParkEasy can actually guarantee —
// and the only kind it earns anything from — sorted BELOW all ~740 seed spots,
// at the very bottom of a list telling the driver these are our recommendations.
//
// THE FIX IS NOT "OUR INVENTORY FIRST BECAUSE IT IS OURS". It is that a space
// you can reserve and pay for before you leave the house answers the question
// this app exists to answer — will I get a space — and a street with a
// hand-assigned weight does not. A listing with no weight is not a listing
// that scored zero on a measured scale; it is one the scale was never about.
//
// SAID OUT LOUD BECAUSE IT CUTS BOTH WAYS: this also puts the revenue line on
// top. The free spots are not hidden, removed or demoted below anything else —
// they keep their existing order directly underneath, "Free First" is still one
// tap away, and the badge filter still works. But anyone reading this file
// should know the change is good for ParkEasy as well as for the driver, and
// decide for themselves whether that is the right trade.
//
// NO NEW BADGE, AND SPECIFICALLY NOT AN "OFFICIAL" TIER. `official` already
// means something factual and load-bearing — a real car park with a named
// operator, as against a street somebody guessed at — and it is on roughly
// sixty NCP, Q-Park, council and Translink car parks that have no relationship
// with ParkEasy whatsoever. Reusing it as a commercial tier would sell a venue
// a label sixty car parks already carry for free, and would destroy the one
// piece of information the badge currently conveys.

/**
 * Can a driver reserve and pay for this right now?
 *
 * EXPLICIT FLAG, NOT INFERRED FROM THE BADGE. A rental listing that is live but
 * outside its availability window is mapped to badge 'paid' when sellable and
 * 'free' when not, so `badge === 'paid'` would promote a space whose Reserve
 * button does not appear — the same lie the card copy was fixed for. App.jsx
 * sets `bookable` from sellableNow(), which is the test checkout itself uses.
 */
export const isBookable = (s) => s?.bookable === true;

/**
 * A featured bookable space, which is a decision already recorded in the data.
 *
 * rental_listings.featured predates this file and already decides which space
 * takes the one promoted slot on the map. Honouring it here keeps that one
 * decision in one place instead of having two orders that disagree.
 */
const isFeatured = (s) => isBookable(s) && s?.featured === true;

/**
 * The "Recommended" order, as a tier number: lower sorts first.
 *
 * Three tiers only. Anything finer would be a ranking nobody asked for, and
 * the weights inside tier 2 are the seed data's, unchanged.
 */
export function recommendedTier(s) {
  if (isFeatured(s)) return 0;
  if (isBookable(s)) return 1;
  return 2;
}

/**
 * Compare two spots for the Recommended sort.
 *
 * Tie-broken by the existing seed weight and then by id, so the order is
 * stable across renders — an unstable comparator makes a list visibly
 * re-shuffle under a driver's thumb on every keystroke.
 */
export function compareRecommended(a, b) {
  const t = recommendedTier(a) - recommendedTier(b);
  if (t) return t;
  const v = (Number(b?.votes) || 0) - (Number(a?.votes) || 0);
  if (v) return v;
  return String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
}

/**
 * How many bookable spaces are in a list — for the one line of copy that tells
 * the driver why the order is what it is.
 *
 * A LIST WITH NONE MUST SAY NOTHING. Thirteen of the fifteen venues with
 * fixtures have no bookable space within 2km, so on most searches this is zero
 * and a note explaining a promotion that did not happen is noise at best.
 */
export const bookableCount = (spots) => (spots || []).filter(isBookable).length;
