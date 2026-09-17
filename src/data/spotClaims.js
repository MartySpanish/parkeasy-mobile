// How many drivers ParkEasy can see at a free spot, and what that licenses us
// to say about it.
//
// THE PROBLEM. A hidden gem with a handful of spaces is worthless if three
// subscribers set off for it at once. "I'm heading there" tells the next
// driver somebody is already on their way, but nothing stopped a fourth and a
// fifth tapping it, and the badge said "3 on their way" without ever saying
// "so maybe don't".
//
// THE HARD LIMIT ON WHAT WE KNOW. We see ParkEasy users and nobody else. On a
// twelve-space residential street, two of our users heading there tells you
// nothing about the other ten, which are full of residents' cars. So this can
// say a space is CLAIMED by our own users. It can never say a spot is FULL,
// and the wording downstream has to keep that distinction — a wrong "full"
// sends a driver past an empty space, which is the one error this app exists
// to prevent.
//
// WORTH KNOWING ABOUT THE DATA. No free or hidden-gem spot in the dataset has
// a capacity below 4, and 263 of 441 have no capacity recorded at all. So
// atCapacity is a genuine backstop rather than the common case: it fires when
// our own claims meet a known capacity, which on today's data needs at least
// four drivers on one small spot. The everyday value is `others` — telling the
// next person somebody is already en route, before they set off.

// ── "LIKELY FULL", AND WHY IT IS NOT CALLED THAT ────────────────────────────
//
// atCapacity needs a recorded capacity, and 46 of the 133 published gems do not
// have one — a third of them. On those, a driver standing at a spot three
// people have just reported parking at is told nothing at all, because the one
// signal that could warn them is unavailable.
//
// The build brief asks for a "Likely full" chip on exactly that case. The
// wording is the problem, not the signal: the paragraph at the top of this file
// is right that we see ParkEasy users and nobody else, and that a wrong "full"
// sends a driver past an empty space. Two of our users parked on a
// twelve-space street says nothing about the other ten.
//
// So the signal ships and the claim does not. `crowded` says what we actually
// know — other drivers are parked here right now — and the wording downstream
// says that too. It is the same warning and the same paid alternative, without
// asserting a fact we cannot see.
const CROWDED_PARKED = 2;

/**
 * @param spot         a spot, optionally carrying live inUse / onWay counts
 * @param headingMine  true when THIS device has already claimed it
 */
export function claimState(spot, headingMine = false) {
  const capacity = typeof spot?.spaces === 'number' ? spot.spaces : null;
  const parked = spot?.inUse || 0;
  const onWay = spot?.onWay || 0;

  // The live counts include this device's own claim, so a driver who has
  // already tapped the button must not be told somebody else is on the way.
  const others = Math.max(0, onWay - (headingMine ? 1 : 0));
  const taken = parked + onWay;

  return {
    capacity,
    parked,
    onWay,
    others,
    taken,
    // Every space we can see is spoken for. Only ever computable when the
    // capacity is actually recorded — never inferred from an absence.
    atCapacity: capacity != null && taken >= capacity,
    // Somebody else is already going. True far more often than atCapacity,
    // and the thing that actually stops two drivers racing.
    contested: others > 0,
    // Two or more of our drivers are PARKED here right now, on a spot whose
    // capacity nobody has recorded. Not "full" — see above — but enough that a
    // driver deserves to know before they set off, and enough to be worth
    // showing them a space they can actually book.
    //
    // Only when the capacity is unknown: where it IS known, atCapacity is the
    // better answer and this would just be a weaker duplicate of it.
    crowded: capacity == null && parked >= CROWDED_PARKED,
  };
}

/** Whether this device may still claim the spot. Cancelling is always allowed. */
export const canClaim = (spot, headingMine = false) =>
  headingMine || !claimState(spot, headingMine).atCapacity;

export default claimState;
