// Item 7: payment/booking error copy. Never show a raw Stripe decline code —
// every message says what happened, why, and how to fix it.
//
// "You haven't been charged" is only ever stated where that is genuinely true:
// a declined/failed payment means no charge was captured, and a lost-slot race
// happens before checkout is created.
const GENERIC = {
  title: 'Something went wrong',
  body: "We couldn't process your payment. You haven't been charged. Try again in a moment — if it keeps happening, try a different card.",
  action: 'Try again',
};

const MAP = {
  card_declined: {
    title: 'Payment declined',
    body: "Your bank declined this payment. This usually isn't something we can fix on our end — try a different card, or contact your bank if it keeps happening.",
    action: 'Try a different card',
  },
  insufficient_funds: {
    title: 'Payment declined',
    body: "Your card doesn't have enough available balance for this payment. Try a different card, or top up and try again.",
    action: 'Try a different card',
  },
  expired_card: {
    title: 'Card expired',
    body: 'This card has expired. Add a different card to complete your booking.',
    action: 'Add a different card',
  },
  slot_taken: {
    title: 'This space just got booked',
    body: "Someone booked this slot while you were checking out. You haven't been charged. Here are other spaces nearby:",
    action: 'See other spaces',
  },
  // NOT a card problem, and it took a photograph of a failed booking to notice
  // that we were calling it one. A driveway published in July had a host who
  // never finished Stripe onboarding; every attempt to book it was refused with
  // a 409, and this file turned that into "try a different card". The driver
  // blames their bank, the host wonders why nobody books, and nothing anywhere
  // says what is actually wrong.
  host_payouts_incomplete: {
    title: 'This space isn’t taking bookings yet',
    body: "The host hasn't finished setting up payments, so we can't take money for this space yet. You haven't been charged. We've flagged it to them — try one of the spaces nearby in the meantime.",
    action: 'See other spaces',
  },
  operator_payout_unset: {
    title: 'This car park isn’t taking bookings yet',
    body: "This car park isn't set up to receive payments yet, so we can't take a booking for it. You haven't been charged.",
    action: 'See other spaces',
  },
};

/**
 * Map a server error into copy a driver can act on.
 *
 * Takes the Error thrown by the API helpers — which carries `.code` when the
 * server named the refusal — or a bare string for the older call sites.
 *
 * THREE TIERS, AND THE MIDDLE ONE IS THE FIX. A named code gets written copy.
 * A refusal the server named but this file does not recognise shows the
 * SERVER'S OWN SENTENCE: those messages ("this car park is closed on Sunday
 * 21 September", "minimum booking is £3.00") are already written for a driver,
 * and replacing them with "try a different card" is both wrong and unactionable.
 * Only an unnamed failure — a real Stripe or network error — falls through to
 * the generic card copy, which is what it was always meant to be for.
 *
 * A raw Stripe decline code can never reach the middle tier, because our own
 * endpoints are the only thing that sets `code`.
 */
export function paymentError(raw) {
  const code = typeof raw === 'object' && raw ? raw.code : null;
  const message = typeof raw === 'object' && raw ? raw.message : raw;
  const s = String(message || '').toLowerCase();

  if (code && MAP[code]) return MAP[code];

  if (/already booked|slot|just got booked/.test(s)) return MAP.slot_taken;
  if (/insufficient[_ ]funds/.test(s))               return MAP.insufficient_funds;
  if (/expired[_ ]card/.test(s))                     return MAP.expired_card;
  if (/card[_ ]declined|do_not_honor|generic_decline|declined/.test(s)) return MAP.card_declined;

  // Named by our own server, but not one of the codes above: show what it said.
  if (code && message) {
    return {
      title: 'We can’t book that',
      body: String(message),
      action: 'Try again',
    };
  }
  return GENERIC;
}

export const PAYMENT_ERRORS = MAP;
