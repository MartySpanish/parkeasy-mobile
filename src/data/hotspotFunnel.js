// When a free spot should be shown a paid alternative — and when it should not.
//
// The whole feature turns on the second half of that sentence. A comparison
// card on every free spot is an advert bolted to the answer somebody came for,
// and it teaches drivers to scroll past the thing we most want them to read.
// So it appears only when there is a genuine decision to make:
//
//   'taken'      every space ParkEasy can see is claimed
//   'crowded'    others are parked here right now, on a spot with no recorded
//                capacity — a third of the gems. Deliberately NOT called
//                "likely full": see the note in data/spotClaims.js.
//   'contested'  somebody else is already on their way
//   'nearby'     neither of those, but a bookable space is close enough to be a
//                real option
//
// AND NEVER on a spot that is itself bookable, because comparing a paid space
// with itself is nonsense.
//
// 1km, raised from 800m. With three active listings, 800m meant most free
// spots had no candidate at all and the funnel simply never appeared — the
// same problem the event-pricing radius had. 1km is a twelve-minute walk,
// still near enough that the distance is not the reason it gets ignored, and
// the card shows the real walk time either way so nobody is misled about it.
// Worth tightening again once there are spaces to be choosy about.
export const NEARBY_RADIUS_M = 1000;

const metresBetween = (aLat, aLng, bLat, bLng) =>
  Math.hypot((aLat - bLat) * 111320, (aLng - bLng) * 65000);

/**
 * The bookable space to offer beside this free spot, or null.
 *
 * @param spot          the free spot on screen
 * @param bookableSpots rental spots (each carrying .listing)
 * @param claim         claimState() for this spot
 * @param sellable      (listing) => boolean — the same gate the Book button uses
 * @param allInFrom     (perHour, perDay) => {total} | null
 */
export function paidAlternativeFor(spot, bookableSpots = [], claim = {}, sellable = () => true, allInFrom = () => null) {
  // A bookable spot does not need an alternative to itself.
  if (!spot || spot.rental) return null;
  // Only free/community spots are in this funnel. A paid council car park is
  // already somebody's paid choice.
  if (!['free', 'hidden_gem'].includes(spot.badge)) return null;

  const candidates = bookableSpots
    .filter(b => b.listing && sellable(b.listing) && typeof b.lat === 'number')
    .map(b => ({
      spot: b,
      listing: b.listing,
      distanceM: metresBetween(spot.lat, spot.lng, b.lat, b.lng),
      allIn: allInFrom(b.listing.price_per_hour, b.listing.price_per_day),
    }))
    .filter(c => c.distanceM <= NEARBY_RADIUS_M)
    // Nearest wins. Not cheapest: the driver is standing somewhere specific and
    // a £2 saving five streets further away is not the better answer.
    .sort((a, b) => a.distanceM - b.distanceM);

  const paid = candidates[0];
  if (!paid) return null;

  // Ordered by how strong the signal is. atCapacity is a fact about a known
  // capacity; crowded is other drivers parked on a spot whose size nobody
  // recorded; contested is somebody merely on their way.
  const reason = claim.atCapacity ? 'taken'
    : claim.crowded ? 'crowded'
    : claim.contested ? 'contested'
    : 'nearby';
  return { ...paid, reason };
}

export default paidAlternativeFor;
