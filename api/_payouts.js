// Can this listing take money, and if not, whose problem is it.
//
// WHY THIS IS ITS OWN FILE. The gate used to live only inside
// create-session.js, at the very end of the booking flow — after the driver had
// picked a date, entered their registration, seen a price and tapped Pay. A
// driveway published in July had a host who never finished Stripe onboarding,
// so every attempt to book it was refused, and because the refusal arrived at
// the card step the app showed "we couldn't process your payment — try a
// different card". Nobody's card was the problem. That listing has taken zero
// bookings and the host has no idea why.
//
// The same question now has one answer used in two places: the booking panel
// asks it BEFORE offering a Pay button (api/listings/bookable.js), and
// create-session asks it again before creating a session. Two copies of this
// rule would eventually disagree, and a gate that disagrees with the screen in
// front of the driver is worse than no gate.

/** The refusal codes, and the sentence each one shows a driver. */
export const PAYOUT_REFUSALS = {
  // An invoice-mode site with no agreed share. A configuration mistake, not a
  // reason to guess at a number and take money we cannot account for.
  operator_payout_unset:
    'This car park isn’t set up for payouts yet, so it can’t be booked. Please try again later.',
  // The common one: a host who published a space but never finished Stripe
  // onboarding, so there is nowhere for their share to land.
  host_payouts_incomplete:
    'This host hasn’t finished setting up payouts yet, so the space can’t be booked.',
};

/**
 * Whether a listing can be paid for, and the connected account to pay into.
 *
 * @param listing a rental_listings row
 * @param ctx     { url, svc } — the Supabase REST base and service headers
 * @returns { ok, code, message, host, invoiceMode }
 *
 * `host` is the host_accounts row, needed as the destination of the charge, and
 * is null in invoice mode (where ParkEasy holds the money and settles later).
 */
export async function payoutReadiness(listing, { url, svc }) {
  // payout_mode is absent on a database where that migration has not been
  // applied, and an absent mode is the default 'connect' — not invoice. Getting
  // this the wrong way round would route a driveway's money into ParkEasy's own
  // balance and pay the host nothing.
  const invoiceMode = listing?.payout_mode === 'invoice';

  if (invoiceMode) {
    if (listing.operator_share_pct == null) {
      return { ok: false, code: 'operator_payout_unset',
               message: PAYOUT_REFUSALS.operator_payout_unset, host: null, invoiceMode };
    }
    return { ok: true, code: null, message: null, host: null, invoiceMode };
  }

  let host = null;
  try {
    const r = await fetch(
      `${url}/rest/v1/host_accounts?host_id=eq.${encodeURIComponent(listing.owner_id)}&select=*`,
      { headers: svc });
    if (r.ok) host = (await r.json())?.[0] || null;
  } catch { /* treated as not ready below */ }

  // Both halves matter. An account id with transfers still pending is an
  // account Stripe will refuse to send money to, and a destination charge that
  // fails at Stripe fails AFTER the driver has been charged.
  if (!host?.stripe_account_id || !host.transfers_active) {
    return { ok: false, code: 'host_payouts_incomplete',
             message: PAYOUT_REFUSALS.host_payouts_incomplete, host, invoiceMode };
  }
  return { ok: true, code: null, message: null, host, invoiceMode };
}
