// The one number the business is judged on, and the leg it was measured from.
//
// 'booking_paid' was fired in exactly one place: the browser, landing back on
// parkeasy.uk from Stripe. So a driver who paid and then closed the receipt
// tab, lost signal in a basement car park, or took a phone call had their
// booking recorded in `bookings` and missing from the funnel. With 477
// registered users and almost no visible completed bookings, the measurement
// was part of the problem.
//
// The fix is a chain, and it only works whole: the browser's session id goes
// to Stripe as checkout metadata, Stripe hands it back on the webhook, and the
// server logs the event under that same id. Break any link and the number is
// wrong in a way nobody can see. These checks hold the chain together.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const cut = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
  .replace(/^\s*--.*$/gm, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/^\s*\/\*[\s\S]*?\*\//gm, '');

const client   = cut('../../src/notify.js');
const checkout = cut('../../api/checkout/create-session.js');
const webhook  = cut('../../api/webhooks/stripe.js');
const mig      = cut('../../supabase/migrations/20260925_booking_paid_authoritative.sql');
const script   = cut('../../scripts/export-never-booked.mjs');

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };

console.log('\nbookingPaid — the session id survives the trip through Stripe');

//------------------------------------------------------------------ the chain
it('the browser sends its session id when it creates a checkout', () => {
  assert.match(client, /analyticsSession: sessionId\(\)/,
    'the checkout request no longer carries the browsing session');
  assert.match(client, /import \{ sessionId \} from '\.\/analytics'/,
    'sessionId is not imported, so the line above would be a ReferenceError');
  // In createBookingSession specifically, not some other request.
  const at = client.indexOf('export async function createBookingSession');
  assert.ok(at > 0, 'createBookingSession is gone');
  assert.match(client.slice(at, client.indexOf('\n}', at)), /analyticsSession/,
    'the session id is sent from somewhere other than the booking checkout');
});

it('the server puts it in Stripe metadata, and only if it is a real session id', () => {
  assert.match(checkout, /analytics_session: analyticsSession \|\| '',/,
    'the session id never reaches Stripe, so the webhook has nothing to log under');
  // It is a client-supplied string that ends up in an analytics table, so the
  // shape is checked rather than trusted.
  assert.match(checkout, /\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{4\}-\[0-9a-f\]\{12\}/,
    'any string at all is forwarded into Stripe metadata');
  const at = checkout.indexOf('const analyticsSession =');
  assert.ok(at > 0, 'the validation is gone');
  assert.match(checkout.slice(at, at + 420), /\.test\(String\(body\?\.analyticsSession \|\| ''\)\)/,
    'the value is not tested against that shape');
  assert.match(checkout.slice(at, at + 420), /: null;/,
    'a malformed session id is stored rather than dropped');
  // And the driver's account, which the funnel needs for a signed-in booking.
  assert.match(checkout, /driver_id: driver\?\.id \|\| '',/,
    "the driver's account is not carried, so every booking looks like a guest's");
});

it('the webhook logs the paid event on the branch that means paid', () => {
  // Not on the driveway branch: an approval booking is AUTHORISED, not
  // charged, and counting it would report money that has not moved.
  const paidBranch = webhook.slice(
    webhook.indexOf("await markBooking(svc, URL_, s.id, { status: 'paid'"),
    webhook.indexOf("case 'checkout.session.async_payment_failed'"));
  assert.ok(paidBranch.length > 100, 'the paid branch is gone');
  assert.match(paidBranch, /logBookingPaid\(svc, URL_, s\)/,
    'a completed payment no longer reaches the funnel');

  const approval = webhook.slice(webhook.indexOf("status: 'awaiting_host'"),
                                 webhook.indexOf("await markBooking(svc, URL_, s.id, { status: 'paid'"));
  assert.ok(!/logBookingPaid/.test(approval),
    'a driveway request is counted as a paid booking — the card is only authorised');
});

it('a failure to log can never fail the payment', () => {
  // Stripe retries a webhook until it gets a 2xx. An exception here would make
  // it re-deliver a payment whose real work — marking the booking, emailing
  // both sides — is already done.
  // The CALL, not the definition — `indexOf('logBookingPaid(')` finds
  // `async function logBookingPaid(` first and would read the wrong lines.
  const at = webhook.indexOf('await logBookingPaid(');
  assert.ok(at > 0, 'the paid event is never logged from the webhook');
  assert.match(webhook.slice(at, at + 200), /\.catch\(e => console\.error\(/,
    'a failed analytics write now turns a successful payment into a retry');
});

it('the event carries what Stripe actually charged, not what we hoped to', () => {
  const fn = webhook.slice(webhook.indexOf('async function logBookingPaid'),
                           webhook.indexOf('async function markBooking'));
  assert.ok(fn.length > 200, 'logBookingPaid is gone');
  assert.match(fn, /p_stripe_session: s\.id/, 'the checkout id is not sent, so nothing can be deduped');
  assert.match(fn, /p_session_id: s\.metadata\?\.analytics_session \|\| null/,
    'the browsing session is not read back out of metadata');
  assert.match(fn, /p_value_pence: Number\.isFinite\(s\.amount_total\) \? s\.amount_total : null/,
    'the amount is taken from somewhere other than the money that moved');
  assert.match(fn, /p_user_id: s\.metadata\?\.driver_id \|\| null/, 'the account is not carried');
  // Through the RPC, which is service-role only — not a direct table write
  // that would need its own rules kept in step.
  assert.match(fn, /rpc\/log_booking_paid/, 'the event is written some other way');
});

//--------------------------------------------------------- the number it feeds
it('the funnel counts a booking with no browsing session', () => {
  // count(distinct session_id) SKIPS NULLS, so a webhook-logged booking from a
  // client that sent no session — an older build, blocked storage, a guest
  // checkout — sat in app_events and never appeared on the dashboard. That is
  // the same undercount in a new place.
  const summary = mig.slice(mig.indexOf("'booking_funnel'"), mig.indexOf("'no_results'"));
  assert.ok(summary.length > 200, 'the booking funnel is gone from the summary');
  assert.match(summary, /coalesce\(session_id::text, 'stripe:' \|\| \(props ->> 'stripe_session'\)\)/,
    'booking_paid is back to counting distinct sessions, which drops sessionless bookings');
  assert.match(summary, /select distinct/, 'the count is no longer per booking');
  assert.match(summary, /session_id is not null or props \? 'stripe_session'/,
    'an event that cannot be identified at all is counted, inflating the number');
  // The other two steps only ever happen in a browser.
  assert.match(summary, /'listing_view',\s+\(select count\(distinct session_id\)/,
    'listing_view is counting events instead of people');
  assert.match(summary, /'booking_start', \(select count\(distinct session_id\)/,
    'booking_start is counting events instead of people');
});

it('the same payment cannot be counted twice', () => {
  // Stripe delivers at least once and retries for days.
  assert.match(mig, /create unique index if not exists app_events_booking_paid_once/,
    'the dedupe index is gone — one payment, three deliveries, three bookings');
  assert.match(mig, /where event_name = 'booking_paid' and props \? 'stripe_session'/,
    'the index is not partial, so no other event may ever mention a checkout');
  assert.match(mig, /on conflict do nothing/, 'a retry now raises instead of being ignored');
});

//------------------------------------------------------------- the export
it('the win-back list is not reachable from the app', () => {
  assert.match(mig, /revoke all on public\.users_never_booked from anon, authenticated;/,
    'every registered email is readable by anonymous callers');
  assert.match(mig, /grant select on public\.users_never_booked to service_role;/,
    'the export script cannot read it');
  assert.match(mig, /with \(security_invoker = false\) as/,
    'the view reads auth.users as the caller, so it returns nothing');
});

it('never booked means never PAID', () => {
  // A declined card and an abandoned checkout both leave a bookings row, and
  // neither is somebody who has parked with us. They are the most winnable
  // people on the list.
  assert.match(mig, /where b\.status = 'paid'/,
    'anybody who ever reached checkout is treated as a customer');
  // Matched on email as well as the account, because a guest checkout has no
  // driver_id and somebody who booked as a guest then signed up is not
  // somebody to win back.
  assert.match(mig, /b\.driver_id = u\.id or lower\(b\.driver_email\) = lower\(u\.email\)/,
    'a guest booking is not matched back to the account that made it');
});

it('the script asks for its key rather than carrying one', () => {
  // The service-role key is the master key to the database. It belongs in an
  // environment variable on Marty's own machine, never in the repository.
  assert.ok(!/eyJ[A-Za-z0-9_-]{20,}/.test(script), 'a key has been pasted into the script');
  assert.match(script, /process\.env\.SUPABASE_SERVICE_ROLE_KEY/, 'the script no longer reads a key');
  assert.match(script, /process\.exit\(2\)/, 'a missing key fails silently instead of saying what to set');
  // Paging, because PostgREST caps a response at 1,000 rows and 477 users is
  // only today's number.
  assert.match(script, /Range: `\$\{from\}-\$\{from \+ PAGE - 1\}`/,
    'the export reads one page and silently stops at a thousand people');
  // CSV quoting, or one address with a comma in it shifts every column.
  assert.match(script, /\/\[",\\n\\r\]\/\.test\(s\)/, 'the CSV is not quoted');
  assert.match(script, /s\.replace\(\/"\/g, '""'\)/, 'a quote inside a value breaks the row');
  // The count goes to stderr so `> winback.csv` gets only the data.
  assert.match(script, /console\.error\(`\\n\$\{all\.length\}/,
    'the summary line is written into the CSV file itself');
});

console.log(`\n  ${passed} checks passed\n`);
