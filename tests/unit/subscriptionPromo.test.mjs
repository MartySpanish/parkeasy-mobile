// SPOTS20 — 20% off the yearly subscription, and the three ways this could
// quietly become a different product.
//
// WHAT IT IS NOT. ParkEasy already has promo codes: promo_codes + promo_
// redemptions + api/redeem-promo.js, which grant FREE DAYS of Premium. That
// system has a `days` column and no concept of an amount, so a 20% discount
// cannot live there — putting SPOTS20 in promo_codes would hand somebody free
// days instead of money off, which is a different offer under the same name.
// The discount is a Stripe promotion code, because Stripe is where the charge
// happens; promo_redemptions stays the ledger. Same split as STRIPE-SUB.
//
// THE THREE REAL RISKS, all asserted below:
//
//   1. The discount leaking onto the monthly plan, or onto a parking booking.
//   2. The expiry being an hour out. "End of day 31 Oct, Europe/London" is
//      only equal to 23:59:59Z because BST has already ended — six days
//      earlier the same literal would be wrong.
//   3. The ledger row becoming a second entitlement. revokePremiumByEmail
//      touches ONLY the STRIPE-SUB row, on purpose, so a SPOTS20 row with a
//      366-day expiry would keep Premium alive for a year after someone
//      cancelled. Free.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const {
  CHECKOUT_PROMOS, checkoutPromo, checkoutPromoExpired, checkoutPromoMessage, discountedPence,
} = await import('../../src/data/subscriptionPromos.js');
const redeem = readFileSync(new URL('../../api/redeem-promo.js', import.meta.url), 'utf8');
const hook = readFileSync(new URL('../../api/webhooks/stripe.js', import.meta.url), 'utf8');

const SPOTS20 = CHECKOUT_PROMOS.find(p => p.code === 'SPOTS20');
// The live list price, read from the comment that documents it in App.jsx, so
// this test fails if the plan is repriced without the maths being revisited.
const ANNUAL_PENCE = 2900;

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };

console.log('\nsubscriptionPromo — 20% off the year, and nothing else');

it('the discount is 20% of the yearly price, in integer pence', () => {
  const d = discountedPence('SPOTS20', 'annual', ANNUAL_PENCE);
  assert.deepEqual(d, { listPence: 2900, discountPence: 580, payPence: 2320 },
    '£29 less 20% is £23.20 — a discount of £5.80');
  // Integers only. A float here becomes a rounding dispute on an invoice.
  for (const v of Object.values(d)) assert.ok(Number.isInteger(v), `${v} is not integer pence`);
  assert.equal(SPOTS20.percentOff, 20, 'the discount is no longer 20%');
});

it('it does not apply to the monthly plan', () => {
  // Returned as null rather than an unchanged price: "wrong plan" is a
  // calculation that cannot produce a number, not a message somebody has to
  // remember to show.
  assert.equal(discountedPence('SPOTS20', 'monthly', 399), null,
    'SPOTS20 discounts the monthly plan');
  assert.equal(SPOTS20.plan, 'annual', 'the code is no longer restricted to the yearly plan');
  // And nothing that is not a subscription plan at all.
  assert.equal(discountedPence('SPOTS20', 'booking', 2300), null,
    'SPOTS20 can be applied to a parking booking');
  assert.equal(discountedPence('SPOTS20', 'service_fee', 300), null,
    'SPOTS20 can be applied to the driver service fee');
});

it('it is pinned to a price LOOKUP KEY, not a price id', () => {
  // Price ids differ between test and live mode. A hardcoded id would be
  // wrong in whichever mode it was not written for.
  assert.equal(SPOTS20.priceLookupKey, 'premium_annual_v2');
  assert.doesNotMatch(JSON.stringify(SPOTS20), /price_1[A-Za-z0-9]+/,
    'a mode-specific Stripe price id has been hardcoded into the promo definition');
});

it('it applies to the first year only, once, and is capped', () => {
  assert.equal(SPOTS20.duration, 'once',
    'the discount repeats on renewal — a 20% forever discount is a different offer');
  assert.equal(SPOTS20.maxRedemptions, 200, 'the 200-redemption cap is gone');
  assert.equal(SPOTS20.firstTimeOnly, true, 'it is no longer restricted to first-time customers');
});

it('the expiry really is end of day 31 Oct 2026 in London', () => {
  const end = Date.parse(SPOTS20.expiresAt);
  assert.ok(Number.isFinite(end), 'the expiry is unparseable');
  // THE ASSUMPTION, CHECKED RATHER THAN TRUSTED: the literal is written in Z,
  // which is only right because BST ended on 25 October 2026. Confirm London
  // is actually at UTC+0 on the expiry date — if the offer ever moves earlier
  // in October this fails instead of silently running an hour long.
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', timeZoneName: 'short',
  }).formatToParts(new Date(end));
  const zone = parts.find(p => p.type === 'timeZoneName')?.value;
  assert.equal(zone, 'GMT',
    `London is in ${zone} at the expiry instant, so a Z literal is the wrong hour`);
  // The London wall-clock reading of that instant.
  const london = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', dateStyle: 'short', timeStyle: 'medium',
  }).format(new Date(end));
  assert.match(london, /31\/10\/2026, 23:59:59/, `the expiry reads as ${london} in London`);
  // Boundary, both sides.
  assert.equal(checkoutPromoExpired('SPOTS20', end), false, 'the final second is already expired');
  assert.equal(checkoutPromoExpired('SPOTS20', end + 1000), true, 'it is still live after the expiry');
  assert.equal(checkoutPromoExpired('SPOTS20', Date.parse('2026-10-01T00:00:00Z')), false,
    'it is expired during the offer');
});

it('entering the code is case-insensitive, and padding does not break it', () => {
  for (const v of ['SPOTS20', 'spots20', 'Spots20', '  spots20  ', 'sPoTs20']) {
    assert.ok(checkoutPromo(v), `"${v}" is not recognised`);
    assert.ok(discountedPence(v, 'annual', ANNUAL_PENCE), `"${v}" produced no discount`);
  }
  // And it is not a prefix match: a different code must not borrow the offer.
  for (const v of ['SPOTS', 'SPOTS200', 'SPOTS2', 'XSPOTS20', '']) {
    assert.equal(checkoutPromo(v), null, `"${v}" is being treated as SPOTS20`);
  }
});

it('typing it in the free-days box explains where it works, rather than "invalid"', () => {
  // The in-app box grants free days. A 20%-off code is real and belongs at
  // Stripe checkout, so "That promo code isn't valid" would be a lie that
  // costs a subscription.
  const msg = checkoutPromoMessage('spots20');
  assert.match(msg, /SPOTS20/, 'the message does not name the code');
  assert.match(msg, /20%/, 'the message does not say what the code is worth');
  assert.match(msg, /yearly/, 'the message does not say which plan it is for');
  assert.doesNotMatch(msg, /isn.t valid|invalid/i, 'the message still calls a valid code invalid');
  // After expiry it says so plainly instead of pointing at checkout.
  const late = checkoutPromoMessage('spots20', Date.parse('2026-11-05T00:00:00Z'));
  assert.match(late, /expired/i, 'an expired code is still being sent to checkout');
  assert.doesNotMatch(late, /enter it on the payment page/i,
    'an expired code is still being sent to checkout');
  // A code that is not a checkout code gets nothing from here, so the normal
  // free-days path still runs.
  assert.equal(checkoutPromoMessage('PARKEZ'), null, 'a free-days code is hijacked by this branch');
  assert.equal(checkoutPromo('PARKEZ6M'), null, 'an existing promo code is treated as checkout-only');
});

it('the endpoint uses that branch before the "not valid" fallback', () => {
  assert.match(redeem, /if \(checkoutPromo\(entered\)\)/, 'the endpoint never checks for a checkout code');
  assert.match(redeem, /checkoutOnly: true/, 'the client cannot tell this apart from a bad code');
  // Order matters: it must come before the promo_codes lookup and the generic
  // rejection, or the specific message is never reached.
  const at = redeem.indexOf('if (checkoutPromo(entered))');
  const generic = redeem.indexOf("That promo code isn’t valid");
  const table = redeem.indexOf('promo_codes?code=eq.');
  assert.ok(at > 0 && at < generic, 'the checkout-code branch is after the generic rejection');
  assert.ok(at < table, 'the checkout-code branch is after the promo_codes lookup');
});

it('the ledger row records a use and grants NOTHING', () => {
  // The risk that would cost real money: revokePremiumByEmail touches only the
  // STRIPE-SUB row, deliberately, so any other row with a future expiry is an
  // independent grant that survives cancellation.
  assert.match(hook, /async function logDiscountUse/, 'the discount is never recorded');
  const at = hook.indexOf('async function logDiscountUse');
  const body = hook.slice(at, hook.indexOf('\n}', hook.indexOf('const ins = await fetch', at)));
  assert.match(body, /expires_at: nowIso/,
    'the ledger row carries a future expiry, so SPOTS20 becomes a second Premium grant that survives cancellation');
  assert.doesNotMatch(body, /86400000/,
    'the ledger row is being given a duration — it is a record, not an entitlement');
  // Still only ever touches STRIPE-SUB on revoke, which is what makes the
  // above necessary. If this changes, the reasoning has moved.
  assert.match(hook, /code=eq\.STRIPE-SUB`,\s*\{ method: 'PATCH'/,
    'revokePremiumByEmail no longer targets only the STRIPE-SUB row');
});

it('recording the discount can never fail the subscription', () => {
  // Somebody has paid. A failed ledger write must not throw out of the grant
  // and have Stripe retry it, or turn into a 500 that loses the entitlement.
  assert.match(hook, /await logDiscountUse\(svc, URL_, s, stripe\)\.catch\(/,
    'a failed discount log can take down the Premium grant for a paying customer');
  const at = hook.indexOf('async function grantPremiumFromPaymentLink');
  const body = hook.slice(at, hook.indexOf('\n}', at));
  assert.ok(body.indexOf('grantPremiumByEmail') < body.indexOf('logDiscountUse'),
    'the discount is logged before the entitlement is granted — the grant is what matters');
  // No discount on the checkout is not an error.
  assert.match(hook, /if \(!\(s\.total_details\?\.amount_discount > 0\)\) return;/,
    'a normal full-price purchase is treated as having a discount to resolve');
});

it('nothing here touches the booking flow or the host share', () => {
  // The 85% host share and the Connect transfer live in the booking path. This
  // change is subscription-only and must not have reached them.
  const at = hook.indexOf('async function logDiscountUse');
  const body = hook.slice(at, hook.indexOf('\n}', hook.indexOf('const ins = await fetch', at)));
  for (const forbidden of ['application_fee', 'transfer_data', 'destination', 'bookings', 'host_id']) {
    assert.ok(!body.includes(forbidden),
      `the discount ledger references ${forbidden} — it must not touch payouts or bookings`);
  }
  // And the promo definition cannot be applied to anything that pays a host.
  assert.equal(discountedPence('SPOTS20', 'annual', ANNUAL_PENCE).payPence, 2320);
  assert.equal(discountedPence('SPOTS20', 'booking', 2000), null);
});

console.log(`\n  ${passed} checks passed\n`);
