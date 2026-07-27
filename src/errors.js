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
};

// Map a server error message / Stripe decline code to friendly copy.
// Unknown codes fall back to the generic processing error, by design.
export function paymentError(raw) {
  const s = String(raw || '').toLowerCase();
  if (/already booked|slot|just got booked/.test(s)) return MAP.slot_taken;
  if (/insufficient[_ ]funds/.test(s))               return MAP.insufficient_funds;
  if (/expired[_ ]card/.test(s))                     return MAP.expired_card;
  if (/card[_ ]declined|do_not_honor|generic_decline|declined/.test(s)) return MAP.card_declined;
  return GENERIC;
}

export const PAYMENT_ERRORS = MAP;
