// The booking that could never work, and the lie the app told about it.
//
// A driveway went live in July. Its host never finished Stripe onboarding, so
// create-session refused every booking with a 409 — correctly. But the refusal
// arrived at the very last step, and errors.js turned every server message it
// did not recognise into "We couldn't process your payment. Try a different
// card." So the driver blamed their bank, the host wondered why nobody booked,
// and the listing took zero bookings in seven weeks. Nothing logged an error.
// It took a photograph of a failed payment screen.
//
// Two defects, and a test for each:
//   1. The reason was thrown away. A code now travels with the refusal, and
//      card copy is only ever shown for something that IS a card problem.
//   2. The question was asked too late. The same gate now runs when the panel
//      opens, so a space that cannot take money never shows a Pay button.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { paymentError, PAYMENT_ERRORS } from '../../src/errors.js';
import { payoutReadiness, PAYOUT_REFUSALS } from '../../api/_payouts.js';
import bookable from '../../api/listings/bookable.js';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const checkout = read('../../api/checkout/create-session.js');
const app = read('../../src/App.jsx');
const notify = read('../../src/notify.js');

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };
const ita = async (what, fn) => { await fn(); passed++; console.log(`  PASS  ${what}`); };

console.log('\nbookingRefusals — say what is actually wrong');

//------------------------------------------------------------ 1. the reason
it('a payouts refusal is not dressed up as a card problem', () => {
  const e = new Error(PAYOUT_REFUSALS.host_payouts_incomplete);
  e.code = 'host_payouts_incomplete';
  const copy = paymentError(e);
  assert.notDeepEqual(copy, paymentError(new Error('boom')), 'still the generic copy');
  assert.ok(!/different card|your bank/i.test(copy.body),
    `sends the driver to their bank over a host's Stripe onboarding: ${copy.body}`);
  assert.ok(!/we couldn't process your payment/i.test(copy.body));
  assert.match(copy.body, /haven't been charged/i, 'does not say they were not charged');
  assert.match(copy.title, /isn.t taking bookings/i, copy.title);
});

it('a refusal the copy does not know about shows what the server said', () => {
  // These sentences are already written for a driver. Replacing them with card
  // advice is both wrong and unactionable.
  const e = new Error('This car park is closed on Sunday 21 September. Please pick a different date.');
  e.code = 'closed_that_day';
  const copy = paymentError(e);
  assert.equal(copy.body, e.message, 'the server’s own sentence was discarded');
  assert.ok(!/different card/i.test(copy.body));
});

it('a real card decline still gets card copy', () => {
  // With no code: that is what an actual Stripe failure looks like.
  assert.deepEqual(paymentError(new Error('card_declined')), PAYMENT_ERRORS.card_declined);
  assert.deepEqual(paymentError('insufficient_funds'), PAYMENT_ERRORS.insufficient_funds);
  assert.deepEqual(paymentError('expired_card'), PAYMENT_ERRORS.expired_card);
  const generic = paymentError(new Error('Cannot read properties of undefined'));
  assert.match(generic.body, /different card/i, 'an unnamed failure lost the generic card copy');
});

it('a raw stripe string can never reach the show-what-the-server-said branch', () => {
  // Only our own endpoints set `code`, and the catch-all 500 — whose message is
  // whatever threw — deliberately does not.
  const tail = checkout.slice(checkout.lastIndexOf('} catch (e) {'));
  assert.match(tail, /error: e\.message \|\| 'Could not start checkout'/, 'the catch-all changed shape');
  assert.ok(!/code:/.test(tail),
    'the catch-all now names its refusal, so a raw Stripe or Postgres error message '
    + 'would be printed to a driver as if we had written it');
});

it('every refusal the checkout endpoint returns is named', () => {
  // Line-based: an exit without a code is one that reads as a card decline.
  const lines = checkout.split('\n');
  const unnamed = [];
  for (let i = 0; i < lines.length; i++) {
    if (!/res\.status\([45]\d\d\)\.json\(/.test(lines[i])) continue;
    // A multi-line json() body: look ahead to its closing brace.
    const block = lines.slice(i, i + 6).join('\n');
    const upToClose = block.slice(0, block.indexOf('});') + 3);
    if (!/code: /.test(upToClose) && !/e\.message \|\| 'Could not start checkout'/.test(upToClose)) {
      unnamed.push(`line ${i + 1}: ${lines[i].trim().slice(0, 90)}`);
    }
  }
  assert.deepEqual(unnamed, [], `refusals with no code:\n  ${unnamed.join('\n  ')}`);
});

it('the client carries the code, not just the sentence', () => {
  const fn = notify.slice(notify.indexOf('export async function createBookingSession'));
  const body = fn.slice(0, fn.indexOf('\n}'));
  assert.match(body, /err\.code = d\.code/, 'the refusal code is dropped on the client side');
  assert.match(app, /setErr\(paymentError\(e\)\)/,
    'App.jsx passes e.message again, which throws the code away before errors.js sees it');
});

//------------------------------------------------------- 2. asked in time
const stubFetch = (rows) => {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const key = Object.keys(rows).find(k => String(url).includes(k));
    if (!key) return { ok: true, json: async () => [] };
    const v = rows[key];
    return typeof v === 'function' ? v() : { ok: true, json: async () => v };
  };
  return calls;
};

await ita('a host with no Stripe account at all cannot be paid', async () => {
  const real = globalThis.fetch;
  stubFetch({ host_accounts: [] });          // exactly the live case: no row
  try {
    const r = await payoutReadiness({ owner_id: 'h1' }, { url: 'https://db.test', svc: {} });
    assert.equal(r.ok, false);
    assert.equal(r.code, 'host_payouts_incomplete');
    assert.equal(r.message, PAYOUT_REFUSALS.host_payouts_incomplete);
  } finally { globalThis.fetch = real; }
});

await ita('an account with transfers still pending cannot be paid either', async () => {
  const real = globalThis.fetch;
  stubFetch({ host_accounts: [{ stripe_account_id: 'acct_1', transfers_active: false }] });
  try {
    // A destination charge to an account Stripe will not transfer to fails
    // AFTER the driver has been charged, so half-onboarded is still no.
    const r = await payoutReadiness({ owner_id: 'h1' }, { url: 'https://db.test', svc: {} });
    assert.equal(r.ok, false, 'a half-onboarded host was treated as payable');
    assert.equal(r.code, 'host_payouts_incomplete');
  } finally { globalThis.fetch = real; }
});

await ita('a fully onboarded host is payable, and the destination comes back', async () => {
  const real = globalThis.fetch;
  stubFetch({ host_accounts: [{ stripe_account_id: 'acct_ok', transfers_active: true }] });
  try {
    const r = await payoutReadiness({ owner_id: 'h1' }, { url: 'https://db.test', svc: {} });
    assert.equal(r.ok, true);
    assert.equal(r.host.stripe_account_id, 'acct_ok', 'the charge has no destination to pay into');
    assert.equal(r.invoiceMode, false);
  } finally { globalThis.fetch = real; }
});

await ita('invoice mode needs a share, and never looks for a Connect account', async () => {
  const real = globalThis.fetch;
  const calls = stubFetch({ host_accounts: [{ stripe_account_id: 'a', transfers_active: true }] });
  try {
    const bad = await payoutReadiness({ owner_id: 'h1', payout_mode: 'invoice' },
      { url: 'https://db.test', svc: {} });
    assert.equal(bad.ok, false);
    assert.equal(bad.code, 'operator_payout_unset');

    const ok = await payoutReadiness({ owner_id: 'h1', payout_mode: 'invoice', operator_share_pct: 70 },
      { url: 'https://db.test', svc: {} });
    assert.equal(ok.ok, true);
    assert.equal(ok.host, null, 'invoice mode has no destination account');
    assert.equal(calls.length, 0, 'invoice mode queried host_accounts for nothing');
  } finally { globalThis.fetch = real; }
});

await ita('a missing payout_mode column means connect, not invoice', async () => {
  // The migration that adds payout_mode is deliberately NOT applied to
  // production. Reading an absent column as 'invoice' would route a driveway's
  // money into ParkEasy's balance and pay the host nothing.
  const real = globalThis.fetch;
  stubFetch({ host_accounts: [] });
  try {
    const r = await payoutReadiness({ owner_id: 'h1' }, { url: 'https://db.test', svc: {} });
    assert.equal(r.invoiceMode, false, 'an absent payout_mode was read as invoice');
    assert.equal(r.code, 'host_payouts_incomplete');
  } finally { globalThis.fetch = real; }
});

const callBookable = async (query) => {
  let status = 0, body = null;
  const res = { setHeader() {}, status(s) { status = s; return this; },
                json(b) { body = b; return this; }, end() { status = status || 204; } };
  await bookable({ method: 'GET', headers: {}, query }, res);
  return { status, body };
};

await ita('the panel is told before the Pay button, not after', async () => {
  const real = globalThis.fetch;
  process.env.SUPABASE_URL = 'https://db.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
  try {
    stubFetch({
      rental_listings: [{ id: 'L1', status: 'active', owner_id: 'h1' }],
      host_accounts: [],
    });
    let r = await callBookable({ listingId: 'L1' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { bookable: false, reason: 'host_payouts_incomplete',
      message: PAYOUT_REFUSALS.host_payouts_incomplete });

    stubFetch({
      rental_listings: [{ id: 'L1', status: 'active', owner_id: 'h1' }],
      host_accounts: [{ stripe_account_id: 'acct_ok', transfers_active: true }],
    });
    r = await callBookable({ listingId: 'L1' });
    assert.deepEqual(r.body, { bookable: true, reason: null });

    stubFetch({ rental_listings: [{ id: 'L1', status: 'paused', owner_id: 'h1' }] });
    r = await callBookable({ listingId: 'L1' });
    assert.equal(r.body.bookable, false);
    assert.equal(r.body.reason, 'not_active');

    stubFetch({ rental_listings: [] });
    r = await callBookable({ listingId: 'L1' });
    assert.equal(r.status, 404);
    assert.equal(r.body.bookable, false);

    r = await callBookable({});
    assert.equal(r.status, 400, 'no listing id should be a bad request');
  } finally { globalThis.fetch = real; }
});

await ita('it never tells a driver about the host, only about the booking', async () => {
  const real = globalThis.fetch;
  process.env.SUPABASE_URL = 'https://db.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
  try {
    stubFetch({
      rental_listings: [{ id: 'L1', status: 'active', owner_id: 'h1', contact_phone: '07700 900000' }],
      host_accounts: [{ stripe_account_id: 'acct_SECRET', transfers_active: false,
                        onboarding_status: 'pending' }],
    });
    const r = await callBookable({ listingId: 'L1' });
    const json = JSON.stringify(r.body);
    for (const leak of ['acct_SECRET', 'onboarding', 'h1', '07700']) {
      assert.ok(!json.includes(leak), `the response leaks ${leak}: ${json}`);
    }
    assert.deepEqual(Object.keys(r.body).sort(), ['bookable', 'message', 'reason']);
  } finally { globalThis.fetch = real; }
});

await ita('a database it cannot reach does not make every space unbookable', async () => {
  const real = globalThis.fetch;
  const savedKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    globalThis.fetch = async () => { throw new Error('network down'); };
    process.env.SUPABASE_URL = 'https://db.test';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
    let r = await callBookable({ listingId: 'L1' });
    assert.equal(r.body.bookable, null, 'a network failure disabled the Pay button');

    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    r = await callBookable({ listingId: 'L1' });
    assert.equal(r.body.bookable, null, 'a deployment with no service key disabled every booking');
  } finally { globalThis.fetch = real; process.env.SUPABASE_SERVICE_ROLE_KEY = savedKey; }
});

it('null is not treated as no, anywhere in the panel', () => {
  const panel = app.slice(app.indexOf('const [payable, setPayable]'));
  assert.match(panel, /payable\.bookable === false/,
    'the panel tests truthiness, so "could not find out" now blocks the booking');
});

it('both pay buttons are gated, not just the card one', () => {
  const panel = app.slice(app.indexOf('const [payable, setPayable]'), app.indexOf('Free cancellation until 24 hours'));
  const buttons = [...panel.matchAll(/disabled=\{busy[^}]*\}/g)].map(m => m[0]);
  assert.ok(buttons.length >= 2, `expected the pass-credit and card buttons, found ${buttons.length}`);
  for (const b of buttons) {
    assert.match(b, /notPayable/, `a pay button that is not gated on payout readiness: ${b}`);
  }
  // A pass credit costs no money but still creates a booking on a space whose
  // host cannot be paid, which is the same broken arrangement for free.
  //
  // Counted, not matched: one button carrying the label satisfied a bare
  // /notPayable \? .../ while the other still read "Closed on that date" for a
  // space that is open and simply cannot take money.
  const labels = panel.match(/notPayable \? 'Not taking bookings yet'/g) || [];
  assert.equal(labels.length, buttons.length,
    `${buttons.length} pay buttons but ${labels.length} say why they are disabled`);
});

it('one gate, two callers — they cannot drift apart', () => {
  assert.match(checkout, /from '\.\.\/_payouts\.js'/, 'checkout has its own copy of the payout rule again');
  assert.match(read('../../api/listings/bookable.js'), /from '\.\.\/_payouts\.js'/,
    'the pre-flight check has its own copy of the payout rule');
  // And the old inline copy is gone for good.
  assert.ok(!/transfers_active/.test(checkout.replace(/^\s*\/\/.*$/gm, '')),
    'checkout still reads transfers_active directly — two rules that will disagree');
});

it('the host is told their live space cannot be booked', () => {
  // The card used to say only "get set up to receive payments", which reads as
  // housekeeping. It never said the live listing was turning bookings away.
  const card = app.slice(app.indexOf('const PayoutSetup'), app.indexOf('const SpacesTab'));
  // The QUERY, not the variable name: a hardcoded liveSpaces = 0 keeps every
  // mention of the name and silently restores the old, vague copy.
  assert.match(card, /from\('rental_listings'\)[\s\S]{0,200}count: 'exact'/,
    'the payout card no longer counts the host’s live spaces');
  assert.match(card, /eq\('status', 'active'\)/, 'it counts drafts as live spaces');
  assert.match(card, /setLiveSpaces\(count \|\| 0\)/, 'the count is never stored');
  // And it has to be STATE. Pinned to a constant, every line above still reads
  // correctly and the card quietly goes back to its old vague copy — while
  // setLiveSpaces is left undefined, which throws only when a host opens the tab.
  assert.match(card, /const \[liveSpaces, setLiveSpaces\] = useState\(0\)/,
    'liveSpaces is no longer state, so the copy can never change');
  assert.match(card, /can’t be booked yet/, 'the card never states the consequence');
  assert.match(card, /every booking gets turned away/, 'the card does not say bookings are being lost');
});

console.log(`\n  ${passed} checks passed\n`);
