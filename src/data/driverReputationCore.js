// How a driver's reputation is WORDED to the host whose gate they are driving
// through — and what must never be implied when there is nothing to say.
//
// The ratings table has been collecting host→driver scores since 27 July and
// nobody could read them: the policy on driver_profiles is "own driver profile
// readable", so the only person who could see a driver's score was that driver.
// Half a trust system, gathered and binned. The half that was missing is the
// half that helps supply — a parish treasurer's question is not what the space
// earns, it is who drives through our gate.
//
// THE HARD PART IS NOT THE QUERY, IT IS THE EMPTY STATE. There are 0 host→
// driver ratings in the database today, so every arrival will come back with
// nothing. "No rating" must therefore read as a plain fact about a new driver
// and never as reassurance ("looks fine!") or as a warning ("unrated — take
// care"). Both would be invented: we do not know, and saying so is the only
// honest option in front of somebody deciding whether to open a gate.
//
// Pure and dependency-free so Node can drive it, the same reason parkedCore and
// eventDemandCore exist.

/** Matches public.driver_rating_floor() — two ratings before a score is shown. */
export const RATING_FLOOR = 2;

/**
 * One line for the host, or null when there is genuinely nothing to show.
 *
 * `rep` is a row from the driver_reputation() RPC: { stars, ratings, stays,
 * newcomer }. A missing row (the booking predates driver accounts, or the
 * driver booked as a guest) returns null rather than a guess.
 */
export const reputationLine = (rep) => {
  if (!rep) return null;
  const stays = Number.isFinite(rep.stays) && rep.stays > 0 ? Math.floor(rep.stays) : 0;
  const ratings = Number.isFinite(rep.ratings) && rep.ratings > 0 ? Math.floor(rep.ratings) : 0;
  const stars = typeof rep.stars === 'number' && rep.stars > 0 ? rep.stars : null;

  // Below the floor a single rating is one identifiable host's opinion of a
  // named person, so the score is withheld by the database and we say what we
  // DO know: how many times this driver has actually parked somewhere.
  if (stars == null || ratings < RATING_FLOOR) {
    return {
      tone: 'neutral',
      // "First stay" is a fact. "Unrated" sounds like a verdict.
      label: stays > 0 ? `${stays} previous ${stays === 1 ? 'stay' : 'stays'}` : 'First stay',
      stars: null,
      stays,
    };
  }
  return {
    // Deliberately NOT a red/amber/green judgement. A host reads the number and
    // decides; a colour-coded risk badge would be us accusing a real person on
    // the strength of two or three strangers' taps.
    tone: 'rated',
    label: `${stars.toFixed(1)} ★ · ${ratings} ${ratings === 1 ? 'rating' : 'ratings'}`,
    stars,
    stays,
  };
};

/**
 * Index RPC rows by booking id, so the arrivals list can look each one up
 * without an O(n²) scan and without caring what order the rows came back in.
 */
export const byBooking = (rows) => {
  const out = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    if (r && r.booking_id) out.set(r.booking_id, r);
  }
  return out;
};
