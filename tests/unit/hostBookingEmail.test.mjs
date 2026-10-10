// The email that tells a host to open the gates — the one string in this
// codebase with a confirmed cost of failure, and until now the one with no test.
//
// WHAT HAPPENED. Friday 7 August, 19:46: two spaces at Davitt Park booked for
// 09:00 the next morning. The club secretary got the email. Nobody opened the
// gates, and two drivers who had each paid £23 were locked out. Those are the
// only two real bookings ParkEasy has ever taken, so the fulfilment failure
// rate on genuine revenue is 100%.
//
// The email was not lost and it was not wrong. It never asked anyone to do
// anything:
//
//   subject   "🅿️ Your space was booked — Michael Davitt GAC — Davitt Park"
//   heading   "You've got a booking"
//   the date  row three of a table
//   "gates"   the word did not appear anywhere in it
//
// Past tense, no date in the subject, no action. On a phone on a Friday night
// that reads as a receipt — something already dealt with.
//
// WHY THIS FILE EXISTS NOW. api/_emails/hostBooking.js was rewritten to fix
// that, and the webhook was resubscribed to checkout.session.completed (it had
// 8 of 12 event types). Both are right. But THERE HAS NOT BEEN A REAL BOOKING
// SINCE 8 AUGUST, so the rewritten email has never once run in production —
// and nothing in the suite touched it. The single most consequential string in
// the product, on the only code path that has never executed, was unguarded.
//
// Every assertion below is one of the four things that failed that Friday, or
// a promise the email makes that another file has to keep.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hostBookingEmail } from '../../api/_emails/hostBooking.js';
import { hostEmails } from '../../api/_hostEmails.js';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };

console.log('\nhostBookingEmail — the email that has never run in production');

const gbp = (p) => `£${(p / 100).toFixed(2)}`;
const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Davitt Park as it actually is: gated 08:00–17:00, 24 hours' notice. */
const listing = (over = {}) => ({
  title: 'Michael Davitt GAC — Davitt Park',
  gate_opens_at: '08:00:00', gate_closes_at: '17:00:00',
  contact_email: 'secretary@davitts.example', owner_email: 'treasurer@davitts.example',
  ...over,
});
const booking = (over = {}) => ({
  starts_at: '2026-08-08T08:00:00+01:00',
  vehicle_reg: 'BT11 ABC',
  amount_total_pence: 2300, booking_price_pence: 2000,
  application_fee_pence: 300, service_fee_pence: 300,
  payout_mode: 'stripe',
  ...over,
});
const build = (l = listing(), b = booking(), now = '2026-08-07T19:46:00+01:00') =>
  hostBookingEmail({
    listing: l, booking: b, title: esc(l.title), ref: 'PE-1234',
    regBlock: `<div id="reg">${b.vehicle_reg || 'none'}</div>`,
    detailRows: '<table id="details"></table>',
    gbp, esc, appUrl: 'https://parkeasy.uk', now,
  });

// ── Failure 1: the subject was past tense and had no date ────────────────────
it('the subject names the action, the time and the day', () => {
  const { subject } = build();
  assert.match(subject, /Open the gates 08:00/, 'the subject does not say what to do');
  assert.match(subject, /Fri, 8 Aug|8 Aug/, 'the subject does not say which day');
  // THE OLD SUBJECT, which must never come back.
  assert.ok(!/was booked/i.test(subject), 'the subject is past tense again');
  assert.ok(!/^🅿️ Your space/.test(subject));
});

it('a booking for tomorrow says TOMORROW, in Belfast time', () => {
  // THE EXACT CASE THAT FAILED: sent Friday night for Saturday morning.
  const { subject, html } = build();
  assert.match(subject, /^TOMORROW — /, `"tomorrow" is not named: ${subject}`);
  assert.match(html, /TOMORROW — ACTION NEEDED/);
  // Today, and neither.
  assert.match(build(listing(), booking(), '2026-08-08T06:00:00+01:00').subject, /^TODAY — /);
  const far = build(listing(), booking({ starts_at: '2026-08-20T08:00:00+01:00' }), '2026-08-07T19:46:00+01:00');
  assert.ok(!/^(TODAY|TOMORROW) — /.test(far.subject), 'a booking 13 days out was called imminent');
});

it('the day is a BELFAST day, not the server\'s', () => {
  // 23:30 UTC on 7 August is 00:30 on the 8th in Belfast. Get this wrong and a
  // booking for Saturday morning is announced as "TODAY" on Friday night — the
  // one word the reader acts on.
  const b = booking({ starts_at: '2026-08-08T08:00:00+01:00' });
  assert.match(build(listing(), b, '2026-08-07T23:30:00Z').subject, /^TODAY — /,
    'at 00:30 Belfast on the 8th, a booking that morning is not "today"');
  assert.match(build(listing(), b, '2026-08-07T22:30:00Z').subject, /^TOMORROW — /,
    'at 23:30 Belfast on the 7th, a booking the next morning is not "tomorrow"');
});

// ── Failure 2: the word "gates" did not appear ───────────────────────────────
it('the word "gates" appears, with both the opening and closing time', () => {
  const { html, subject } = build();
  assert.match(html, /Open the gates at 08:00/, 'the instruction is gone');
  assert.match(html, /Gates lock again at 17:00/, 'the closing time is not given');
  assert.ok(/gates/i.test(subject), 'the subject no longer mentions the gates');
});

it('a listing with no gate time does not tell anyone to open gates', () => {
  // A private driveway has no gates. Telling its owner to open some is noise,
  // and noise is how people start ignoring the email that matters.
  const { subject, html } = build(listing({ gate_opens_at: null, gate_closes_at: null }));
  assert.ok(!/gates/i.test(subject), `a gateless listing's subject mentions gates: ${subject}`);
  assert.ok(!/Open the gates/.test(html), 'a gateless listing is told to open gates');
  assert.ok(!/ACTION NEEDED/.test(html), 'a gateless listing gets an action banner');
  // It still says what and when.
  assert.match(subject, /8 Aug/);
  assert.match(subject, /BT11 ABC/);
});

// ── Failure 3 & 4: the order. Action first, money last ───────────────────────
it('the instruction comes before the details, the reg and the money', () => {
  // The old email led with the registration plate and put the date in row
  // three of a table. Order is the fix.
  const { html } = build();
  const i = (s) => html.indexOf(s);
  assert.ok(i('ACTION NEEDED') >= 0, 'no action banner');
  assert.ok(i('ACTION NEEDED') < i('Booking details'), 'the action is below the details heading');
  assert.ok(i('ACTION NEEDED') < i('id="reg"'), 'the registration plate is above the instruction again');
  assert.ok(i('What you earn') > i('id="reg"'), 'the money is above the registration');
  assert.ok(i('What you earn') > i('ACTION NEEDED'), 'the money is above the instruction');
});

it('the registration block a marshal stands in the car park holding is present', () => {
  // Asked for directly by a host committee. Kept from the old email, moved.
  assert.match(build().html, /id="reg">BT11 ABC/);
  // And a booking with no plate still produces an email.
  assert.doesNotThrow(() => build(listing(), booking({ vehicle_reg: null })));
  assert.match(build(listing(), booking({ vehicle_reg: null })).subject, /1 car booked/);
});

// ── The two payout models: the wrong sentence is a promise we don't keep ─────
it('an invoice-mode site is never promised a Stripe payout', () => {
  // ParkEasy holds the money on an invoice site and settles separately. Telling
  // that operator to expect a weekly Stripe payout leaves them waiting on a
  // transfer that never arrives and chasing the wrong people.
  const inv = build(listing(), booking({ payout_mode: 'invoice', operator_share_pence: 1700 }));
  assert.match(inv.html, /settles with you by invoice/, 'invoice mode is not explained');
  assert.match(inv.html, /there is no Stripe payout on this site/, 'the Stripe caveat is gone');
  assert.ok(!/paid out weekly by Stripe/.test(inv.html), 'an invoice site was promised a Stripe payout');
  assert.match(inv.html, /£17\.00/, 'the operator share is not the figure shown');

  // And the Stripe case still says the Stripe thing.
  const str = build();
  assert.match(str.html, /paid out weekly by Stripe/);
  assert.ok(!/no Stripe payout/.test(str.html));
  // 2000 - (300 - 300) = 2000.
  assert.match(str.html, /£20\.00/, 'the host share is wrong for a Stripe payout site');
  assert.match(str.html, /£23\.00/, 'the driver total is not shown');
});

// ── A promise another file has to keep ───────────────────────────────────────
it('the full-refund escape hatch matches what cancel.js actually refunds', () => {
  // The email tells a host: block the date and "we will refund the driver in
  // full at our cost, not yours". That is a claim about api/bookings/cancel.js.
  // The same class of defect as the checkout line that promised a full refund
  // while the code kept the service fee (#265) — so the two are checked
  // together rather than trusted.
  assert.match(build().html, /refund the driver\s*\n?\s*in full at our cost, not yours/,
    'the escape hatch wording changed');
  const cancel = read('../../api/bookings/cancel.js')
    .split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  assert.match(cancel, /if \(isHost\) refundPence = booking\.amount_total_pence/,
    'a host cancellation no longer refunds the driver in full — the host email promises it does');
});

// ── Both the people who need it ──────────────────────────────────────────────
it('both the day-to-day contact and the payout account are told', () => {
  // THE OTHER HALF OF 8 AUGUST. The email went to contact_email alone, so the
  // secretary was told and the treasurer — who did the Stripe onboarding and
  // was reconciling a payout against bookings he could not see — was not.
  assert.deepEqual(hostEmails(listing()), ['secretary@davitts.example', 'treasurer@davitts.example']);
  // A driveway host whose two fields match gets ONE email, not two identical ones.
  assert.deepEqual(hostEmails({ contact_email: 'me@x.example', owner_email: 'ME@X.example' }),
    ['me@x.example'], 'the same address was emailed twice');
  // Missing fields are skipped, not sent to ''.
  assert.deepEqual(hostEmails({ contact_email: '  ', owner_email: 'o@x.example' }), ['o@x.example']);
  assert.deepEqual(hostEmails({}), []);
  assert.deepEqual(hostEmails(null), []);
});

it('the webhook sends to every address hostEmails returns', () => {
  const hook = read('../../api/webhooks/stripe.js')
    .split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
  assert.match(hook, /for \(const to of hostEmails\(listing\)\) jobs\.push\(send\(to, hostMail\.subject, hostMail\.html\)\)/,
    'the webhook no longer sends to both host addresses');
  assert.match(hook, /const hostMail = hostBookingEmail\(\{/, 'the webhook no longer uses this email');
  // The listing read must fetch both columns, or hostEmails has nothing to dedupe.
  assert.match(hook, /select=[^'"`]*contact_email/, 'the webhook does not select contact_email');
  assert.match(hook, /select=[^'"`]*owner_email/, 'the webhook does not select owner_email');
});

it('nothing throws on the sparse booking a real webhook can deliver', () => {
  for (const b of [
    booking({ starts_at: null }),
    booking({ vehicle_reg: null, starts_at: null }),
    booking({ amount_total_pence: 0, booking_price_pence: 0, application_fee_pence: 0, service_fee_pence: 0 }),
    booking({ payout_mode: 'invoice', operator_share_pence: null }),
  ]) {
    assert.doesNotThrow(() => build(listing(), b), `threw on ${JSON.stringify(b.starts_at)}`);
    const { subject, html } = build(listing(), b);
    assert.ok(subject && subject.length > 10, 'an empty subject');
    assert.ok(!/undefined|NaN|null/.test(subject), `a missing field leaked into the subject: ${subject}`);
    assert.ok(!/undefined|NaN/.test(html), 'a missing field leaked into the body');
  }
});

console.log(`\n  ${passed} checks passed\n`);
