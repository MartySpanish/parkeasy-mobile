// What a bookable space can honestly promise.
//
// ParkEasy sells two different things under one "Book" button.
//
//   A HOST SITE — Davitt Park, Belfast Royal Academy — is a car park ParkEasy
//   has a signed agreement over. The host holds the space. "Held for you when
//   you arrive" is simply true, and it is the reason somebody pays in advance
//   rather than chancing the street.
//
//   An OPERATOR SITE — APCOA, NCP, Q-Park — is not ParkEasy's to hold. These
//   operators oversell on purpose and their own season-ticket terms say a
//   ticket "does not guarantee you a space". What is being sold there is entry
//   against a quota. Saying "held for you" would be making somebody else's
//   promise for them, at a barrier ParkEasy does not control.
//
// Two APCOA listings are already in rental_listings at status='draft'. The day
// one of those goes active, the copy has to change with it and nobody should
// have to remember that — hence a flag and a function rather than a convention.
//
// See supabase/migrations/20260820_operator_site_terminology.sql.

/** True when any of these spaces belongs to a commercial car park operator. */
export const hasOperatorSite = (items = []) =>
  items.some(s => (s?.listing ?? s)?.is_operator_site === true);

/**
 * The line that sits under a "book a space" heading.
 * Mixed lists get the weaker claim, because the stronger one would be wrong
 * about at least one of the spaces on screen.
 */
export const holdCopy = (items = []) =>
  hasOperatorSite(items)
    ? 'Paid in advance. Guaranteed entry at the barrier — spaces inside are first come, first served.'
    : 'Reserved and paid in advance, held for you when you arrive.';

export default holdCopy;
