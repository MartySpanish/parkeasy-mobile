// Who at a host organisation gets told about a booking.
//
// THE BUG THIS FIXES. A listing has two addresses on it:
//
//   contact_email  the day-to-day contact — who a driver's question goes to
//   owner_email    the account that owns the listing and takes the payout
//
// For an ordinary driveway host they are the same person and this is moot.
// For an organisation they are not. Michael Davitt GAC's contact_email is the
// club secretary; owner_email is the treasurer, who did the Stripe onboarding
// and receives the money. Every booking email went to contact_email alone, so
// the two paid bookings on 8 August were announced to the secretary and the
// treasurer — the person reconciling a Stripe payout against bookings he
// cannot see — was told nothing.
//
// Both, then. Deduplicated case-insensitively, so a driveway host whose two
// fields match still gets exactly one email rather than two identical ones.
//
// Deliberately NOT applied to driver→host messages in api/messages.js. "Which
// gate do I use?" belongs with the secretary; copying the treasurer on every
// message is noise, and noise is how people start ignoring the email that
// actually matters.

/**
 * Every address that should hear about money on a listing, deduped.
 * @param listing a rental_listings row (needs contact_email / owner_email)
 * @returns string[] — may be empty; callers must handle that
 */
export function hostEmails(listing) {
  const seen = new Set();
  const out = [];
  for (const raw of [listing?.contact_email, listing?.owner_email]) {
    const email = String(raw || '').trim();
    if (!email) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(email);
  }
  return out;
}

export default hostEmails;
