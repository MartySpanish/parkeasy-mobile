// The email that tells a host somebody is coming.
//
// WHY THIS FILE EXISTS. On Friday 7 August at 19:46 two spaces at Davitt Park
// were booked for 09:00 the next morning. The club secretary received the
// email. Nobody opened the gates, and two drivers who had paid £23 each were
// locked out.
//
// The email was not lost and it was not wrong. It simply never asked anyone to
// do anything:
//
//   subject   "🅿️ Your space was booked — Michael Davitt GAC — Davitt Park"
//   heading   "You've got a booking"
//   the date  row three of a table, under a full-width registration plate
//   "gates"   the word did not appear anywhere in it
//
// Past tense, no date in the subject, no action. Read on a phone on a Friday
// night it looks like a receipt — something that has already been dealt with.
//
// So this version is built around one question: what does the person reading
// it have to DO, and by when. The date and the gate time go in the subject.
// The instruction goes above everything else. The money — which is what the
// old email led with after the plate — goes last, because nobody ever missed
// a payout by not reading an email.
//
// Kept from the old one: the big registration block. A host committee asked
// for that directly — "this is how we know who has booked and paid so we can
// direct them to their space" — and it works. It just belongs under the
// instruction rather than in place of it.

/** Whole days between now and the arrival, in Belfast. Negative = in the past. */
function daysUntil(startsAt, now = new Date()) {
  const ymd = (d) => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
  const a = new Date(`${ymd(now)}T00:00:00Z`);
  const b = new Date(`${ymd(new Date(startsAt))}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

/**
 * @param opts.listing     rental_listings row
 * @param opts.booking     bookings row
 * @param opts.when        display date already formatted by the caller
 * @param opts.title       escaped listing title
 * @param opts.ref         short booking reference
 * @param opts.regBlock    the registration-plate HTML block
 * @param opts.detailRows  the Space/Address/When/Vehicle table
 * @param opts.gbp         money formatter
 * @param opts.esc         HTML escaper
 * @param opts.appUrl      base URL for the manage link
 * @param opts.now         injectable for tests
 * @returns {{subject: string, html: string}}
 */
export function hostBookingEmail(opts) {
  const { listing, booking: b, title, ref, regBlock, detailRows, gbp, esc, appUrl, now } = opts;

  const opens = listing?.gate_opens_at ? String(listing.gate_opens_at).slice(0, 5) : null;
  const closes = listing?.gate_closes_at ? String(listing.gate_closes_at).slice(0, 5) : null;
  const gated = Boolean(opens);

  const dayLabel = b.starts_at
    ? new Date(b.starts_at).toLocaleDateString('en-GB',
        { timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short' })
    : null;
  const d = b.starts_at ? daysUntil(b.starts_at, now ? new Date(now) : undefined) : null;
  // "Tomorrow" is the case that failed. Name it, rather than printing a date
  // and trusting a tired reader to work out that it means the morning.
  const soonWord = d === 0 ? 'TODAY' : d === 1 ? 'TOMORROW' : null;

  // Subject: what to do, when, and only then which car. Everything a phone
  // shows in the preview line before you open it.
  const subject = gated && dayLabel
    ? `${soonWord ? `${soonWord} — ` : ''}Open the gates ${opens} on ${dayLabel} · ${b.vehicle_reg ? `car ${b.vehicle_reg}` : '1 car'} booked at ${title}`
    : `Booking${dayLabel ? ` for ${dayLabel}` : ''}${b.vehicle_reg ? ` — ${b.vehicle_reg}` : ''} · ${title}`;

  // The instruction, before anything else, and loudest when it is imminent.
  const urgent = soonWord !== null;
  const action = gated ? `
    <div style="font-family:system-ui;margin:0 0 16px;padding:16px 18px;border-radius:10px;
      border:2px solid ${urgent ? '#dc2626' : '#0f766e'};background:${urgent ? '#fef2f2' : '#f0fdfa'}">
      <div style="font-size:12px;font-weight:800;letter-spacing:.12em;color:${urgent ? '#dc2626' : '#0f766e'}">
        ${soonWord ? `${soonWord} — ACTION NEEDED` : 'ACTION NEEDED'}
      </div>
      <div style="font-size:21px;font-weight:800;color:#0f172a;margin-top:6px;line-height:1.3">
        Open the gates at ${esc(opens)}${dayLabel ? ` on ${esc(dayLabel)}` : ''}
      </div>
      <div style="font-size:15px;color:#334155;margin-top:8px">
        Someone has paid to park${b.vehicle_reg ? '' : ' at your site'} and is expecting to get in.
        ${closes ? `Gates lock again at ${esc(closes)}.` : ''}
      </div>
      <div style="font-size:13px;color:#64748b;margin-top:10px">
        Can't open the gates that day? Block the date in the app and we will refund the driver
        in full at our cost, not yours — but please do it before they set off.
      </div>
    </div>` : '';

  // Two payout models, and the wrong sentence here is a promise we don't keep.
  // A club is paid by Stripe automatically. An invoice-mode operator is not
  // paid by anything — ParkEasy holds the money and settles by invoice — so
  // telling them to expect a weekly Stripe payout would have them waiting on a
  // transfer that never arrives, and chasing the wrong people about it.
  const invoiceMode = b.payout_mode === 'invoice';
  const yours = invoiceMode
    ? (b.operator_share_pence || 0)
    : (b.booking_price_pence - (b.application_fee_pence - b.service_fee_pence));
  const money = `<h3 style="font-family:system-ui;margin:20px 0 4px;font-size:15px">What you earn</h3>
    <table style="border-collapse:collapse;font-family:system-ui">
      <tr><td style="padding:4px 10px;color:#64748b">Driver paid</td><td style="padding:4px 10px">${gbp(b.amount_total_pence)}</td></tr>
      <tr><td style="padding:4px 10px;color:#64748b">You receive</td><td style="padding:4px 10px"><strong>${gbp(yours)}</strong> ${invoiceMode
        ? 'under your agreed share. ParkEasy collects the payment and settles with you by invoice &mdash; there is no Stripe payout on this site.'
        : '(after 15% fee), paid out weekly by Stripe.'}</td></tr>
    </table>`;

  const manage = `<p style="font-family:system-ui;margin:18px 0">
      <a href="${appUrl}/?tab=spaces" style="background:#2ED3C6;color:#06231f;font-weight:700;text-decoration:none;padding:12px 20px;border-radius:24px;display:inline-block">View all your bookings &rarr;</a>
    </p>
    <p style="font-family:system-ui;color:#64748b;font-size:12px">Every booking, with its registration and arrival date, is in the app under <strong>Spaces &rarr; Your bookings</strong>. You can also subscribe to your bookings calendar there so they appear alongside everything else in your diary.</p>`;

  const html = `${action}<h2 style="font-family:system-ui;margin:0 0 4px">Booking details</h2>`
    + `${regBlock}${detailRows}${money}${manage}`
    + `<p style="font-family:system-ui;color:#64748b;font-size:12px">Reference ${esc(ref)}.</p>`;

  return { subject, html };
}

export default hostBookingEmail;
