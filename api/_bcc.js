// A blind copy of the transactional mail that goes to somebody else.
//
// WHY. Most of what this app sends lands in a stranger's inbox — a booking
// confirmation, a message from a host, "your spot is live". When one of those
// is ignored, Marty currently has no way to know what the person was actually
// sent, so he cannot follow it up without guessing. A BCC means the chase can
// start from the exact email they received rather than a reconstruction of it.
//
// BLIND, not cc. The recipient must not see a third address on a message about
// their own booking — that reads like a leak even when it isn't.
//
// NOT applied to mail that already comes to him. api/notify.js, the founder
// booking summary in the Stripe webhook and the admin copy in bookings/cancel
// all address him directly, so a bcc on top would arrive twice. bccFor() takes
// the recipient list and returns nothing when he is already on it, which makes
// that safe to get wrong at the call site.
//
// Env:
//   EMAIL_BCC     where the copies go. Defaults to CONTACT_EMAIL, which is
//                 already set — so this needs no new configuration to work.
//                 Set it to "off" to stop the copies without unsetting the
//                 address the rest of the app notifies.

const norm = (s) => String(s || '').trim().toLowerCase();

/**
 * The bcc list for a message addressed to `to`.
 * @param to a Resend `to` value — string or array of addresses
 * @returns string[] to spread into the payload, or undefined for no bcc
 */
export function bccFor(to) {
  const raw = String(process.env.EMAIL_BCC ?? process.env.CONTACT_EMAIL ?? '').trim();
  if (!raw || norm(raw) === 'off') return undefined;

  // Already a recipient — sending it again would just be a duplicate.
  const recipients = (Array.isArray(to) ? to : [to]).map(norm);
  if (recipients.includes(norm(raw))) return undefined;

  return [raw];
}

export default bccFor;
