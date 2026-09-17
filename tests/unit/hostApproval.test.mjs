// Parking at somebody's house is a request, not a purchase.
//
// The one failure that matters is money leaving a driver's card for a space the
// host never agreed to give them. Everything below guards a step on that path,
// and each is a change that would look harmless in a diff:
//
//   - dropping capture_method, so the card is charged at checkout;
//   - marking the booking paid in the webhook, so it reads as confirmed;
//   - capturing on a decline, or declining without releasing the hold;
//   - a sweep that cancels requests the host still has time to answer.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const checkout  = read('../../api/checkout/create-session.js');
const webhook   = read('../../api/webhooks/stripe.js');
const respond   = read('../../api/bookings/respond.js');
const sweep     = read('../../api/cron/expire-approvals.js');
const migration = read('../../supabase/migrations/20260907_host_approval.sql');
const vercel    = JSON.parse(read('../../vercel.json'));
const app       = read('../../src/App.jsx');

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };

console.log('\nhostApproval — the host has to say yes before the money moves');

it('checkout authorises rather than charges when approval is needed', () => {
  assert.match(checkout, /const needsApproval = listing\.requires_host_approval === true/,
    'checkout no longer reads the listing flag');
  // Both branches — destination charge AND invoice mode — must authorise.
  const captures = checkout.match(/capture_method: 'manual'/g) || [];
  assert.equal(captures.length, 2,
    `capture_method: 'manual' appears ${captures.length} times; both the destination-charge and invoice-mode branches need it`);
  assert.match(checkout, /\.\.\.\(needsApproval \? \{ capture_method: 'manual' \} : \{\}\)/,
    'manual capture is applied unconditionally — that would authorise every booking, including instant ones');
});

it('the request has a deadline, and it never outlives the parking slot', () => {
  // A request for a space in three hours cannot sit for a day, and nobody
  // should hold an authorisation for a slot that has already begun.
  assert.match(checkout, /Math\.min\(now \+ 24 \* 3600000, firstStart \|\| Infinity\)/,
    'the approval deadline is no longer the sooner of 24 hours and the start time');
});

it('the flag is snapshotted onto the booking, not read back later', () => {
  assert.match(checkout, /requires_host_approval: needsApproval/,
    'the booking no longer records whether it needed approval');
});

it('the webhook parks it as a request, and does not confirm it', () => {
  assert.match(webhook, /s\.metadata\?\.needs_approval === 'true'/,
    'the webhook no longer distinguishes a request from a purchase');
  assert.match(webhook, /status: 'awaiting_host'/,
    'the webhook no longer parks approval bookings in awaiting_host');
  // The confirmation email must NOT go out — it tells the driver to turn up.
  const branch = webhook.slice(webhook.indexOf("needs_approval === 'true'"), webhook.indexOf('} else {', webhook.indexOf("needs_approval === 'true'")));
  assert.ok(!/sendBookingEmails/.test(branch),
    'the request branch sends the arrival confirmation — the driver would turn up at a space nobody agreed to');
  assert.match(branch, /sendApprovalRequestEmails/, 'the host is never asked');
});

it('accept captures, decline releases — and neither can double-fire', () => {
  assert.match(respond, /stripe\.paymentIntents\.capture\(booking\.stripe_payment_intent\)/,
    'accepting no longer captures the payment');
  assert.match(respond, /stripe\.paymentIntents\.cancel\(booking\.stripe_payment_intent\)/,
    'declining no longer releases the authorisation — the hold would sit on the card');
  // Idempotency: a mail client prefetching the link, or a host tapping twice.
  assert.match(respond, /if \(booking\.status !== 'awaiting_host'\)/,
    'the endpoint no longer refuses a request that was already answered');
  // Capture BEFORE the row is written: if capture fails nothing is recorded, so
  // the request stays answerable rather than reading as paid with no money.
  const acceptBlock = respond.slice(respond.indexOf("if (answer === 'accept')"), respond.indexOf('// Decline.'));
  assert.ok(acceptBlock.indexOf('paymentIntents.capture') < acceptBlock.indexOf("status: 'paid'"),
    'the booking is marked paid before the capture succeeds');
});

it('the sweep only touches requests that have actually lapsed', () => {
  assert.match(sweep, /status=eq\.awaiting_host&approval_deadline=lt\./,
    'the expiry sweep no longer filters on BOTH status and deadline — it could cancel live bookings');
  // Release the hold first; if that fails, leave the row for the next run.
  const loop = sweep.slice(sweep.indexOf('for (const b of due)'));
  assert.ok(loop.indexOf('paymentIntents.cancel') < loop.indexOf("status: 'expired'"),
    'the row is marked expired before the hold is released — the driver would keep the pending charge');
  assert.match(sweep, /MAX_PER_RUN/, 'the sweep is unbounded');
  assert.match(sweep, /auth !== secret/, 'the sweep is no longer behind CRON_SECRET');
});

it('the sweep runs hourly, not daily', () => {
  const cron = (vercel.crons || []).find(c => c.path === '/api/cron/expire-approvals');
  assert.ok(cron, 'the expiry sweep is not scheduled');
  assert.equal(cron.schedule, '0 * * * *',
    `the sweep runs "${cron.schedule}" — a deadline can be three hours out, so a daily sweep strands the driver`);
});

it('the database refuses a capture nobody approved', () => {
  // The one guard that is not code somebody can edit around.
  assert.match(migration, /check \(not \(requires_host_approval and status = 'paid' and host_responded_at is null\)\)/,
    'the invariant constraint is gone — the whole feature is then just convention');
});

it('the driver is never told a request is confirmed', () => {
  assert.match(checkout, /booking=\$\{needsApproval \? 'requested' : 'success'\}/,
    'a request returns to the same success URL as a purchase');
  assert.match(app, /booking === 'requested'/, 'the app no longer handles the request return');
  // Comments stripped first. The branch explains in prose that it must not say
  // "your payment went through", and a check that cannot tell the message from
  // the commentary is a check that fires on its own documentation.
  const branch = app.slice(app.indexOf("booking === 'requested'"), app.indexOf("booking === 'requested'") + 1600);
  const code = branch.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  assert.match(code, /NOT been charged/,
    'the return message no longer says the driver has not been charged');
  assert.ok(!/payment went through/.test(code),
    'the request return still claims the payment went through');
  assert.ok(!/tone: 'ok'/.test(code.slice(0, code.indexOf('setFlash') + 200)),
    'the request return is styled as a success — it is a pending request');
});

console.log(`\n  ${passed} checks passed\n`);
