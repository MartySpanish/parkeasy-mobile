// The partner subscription lifecycle, and the four ways it goes wrong quietly.
//
//   1. A partner session falls into the Premium branch, so a barber paying £25
//      for a listing is granted Premium instead and never gets a card.
//   2. Nothing records the subscription id, so the first renewal invoice finds
//      no partner and the tier is never set.
//   3. One failed payment pulls a live card, over a Tuesday card expiry.
//   4. sold_at is overwritten on every renewal, losing the one date that says
//      how long somebody has been a customer.
//
// None of these throw. All four are silent until a partner rings up.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const webhook = read('../../api/webhooks/stripe.js');
const link    = read('../../api/partners/checkout-link.js');

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };

console.log('\npartnerBilling — £25 a month has to reach the right place');

it('a partner checkout is not mistaken for a Premium purchase', () => {
  const i = webhook.indexOf("s.metadata?.partner_id");
  const j = webhook.indexOf("!s.metadata?.pass_id && !s.metadata?.listing_id");
  assert.ok(i > 0, 'the webhook no longer recognises a partner subscription session');
  assert.ok(i < j,
    'the partner branch runs AFTER the Premium fallback — a partner paying for a card would be granted Premium instead');
});

it('the subscription id is recorded at the only moment it exists', () => {
  // Stripe creates the subscription at PAYMENT in subscription mode, not when
  // the checkout link is made — so the link endpoint has nothing to record, and
  // this is the webhook's only chance. Without it partnerForSubscription()
  // finds nothing on the first renewal invoice.
  const branch = webhook.slice(webhook.indexOf("s.metadata?.partner_id"), webhook.indexOf("s.metadata?.partner_id") + 400);
  assert.match(branch, /stripe_subscription_id: s\.subscription/,
    'the subscription id is not stored — every later invoice would find no partner');
  assert.match(branch, /stripe_customer_id: s\.customer/,
    'the customer id is not stored — an upgrade would create a second Stripe customer');
  assert.ok(!/session\.subscription/.test(link),
    'the link endpoint reads session.subscription, which is null in subscription mode');
});

it('one failed payment does not pull a live card', () => {
  assert.match(webhook, /PARTNER_GRACE_DAYS = (\d+)/, 'the grace period is gone');
  const days = Number(webhook.match(/PARTNER_GRACE_DAYS = (\d+)/)[1]);
  assert.ok(days >= 5, `the grace period is ${days} days — too short to survive a card expiry and Stripe's retries`);
  assert.match(webhook, /if \(overdueDays >= PARTNER_GRACE_DAYS\)/,
    'the downgrade no longer waits for the grace window');
  // The clock starts on the FIRST failure and is not reset by later ones, or
  // the window never elapses and the tier is never dropped.
  assert.match(webhook, /else if \(!failedPartner\.payment_failed_at\)/,
    'payment_failed_at is rewritten on every failure — the grace window would never expire');
});

it('a successful payment clears the failure clock', () => {
  const paid = webhook.slice(webhook.indexOf('const paidPartner'), webhook.indexOf('const paidPartner') + 1200);
  assert.match(paid, /payment_failed_at: null/,
    'a recovered payment leaves the failure clock running — the next failure would drop them immediately');
});

it('sold_at records the first payment and never moves', () => {
  const paid = webhook.slice(webhook.indexOf('const paidPartner'), webhook.indexOf('const paidPartner') + 1200);
  assert.match(paid, /\.\.\.\(paidPartner\.sold_at \? \{\} : \{ sold_at:/,
    'sold_at is overwritten on renewal — the date they became a customer would be lost');
  assert.match(paid, /renewal_due_at:/, 'the next renewal date is no longer recorded');
});

it('cancelling takes the card down but keeps the partner', () => {
  const gone = webhook.slice(webhook.indexOf('const goneP'), webhook.indexOf('const goneP') + 400);
  assert.match(gone, /tier: 'listed'/, 'a cancelled partner keeps their paid card');
  assert.ok(!/delete|DELETE/.test(gone),
    'the partner row is deleted on cancellation — their pin and impression history go with it');
});

it('the tier comes from metadata, not from a price id', () => {
  // A price can be duplicated or swapped in the Stripe dashboard. Mapping a
  // price id back to a tier means a partner silently drops from sponsored to
  // featured because somebody made a new price.
  assert.match(link, /subscription_data: \{ metadata: meta \}/,
    'the tier is not mirrored onto the subscription — it would be gone by the first renewal');
  assert.match(webhook, /metadata\?\.tier/, 'the webhook no longer reads the tier from metadata');
  assert.match(webhook, /\['featured', 'sponsored'\]\.includes\(tier\)/,
    'the webhook accepts any tier string from Stripe metadata');
});

it('price ids come from the environment, never from the caller', () => {
  assert.match(link, /process\.env\[PRICE_ENV\[tier\]\]/, 'price ids are no longer read from the environment');
  assert.ok(!/body\?\.price|body\.priceId/.test(link),
    'the endpoint takes a price from the request body — anybody could buy a £60 card for whatever they sent');
  assert.match(link, /TIERS\[tier\]\.pricePence === 0/,
    'the endpoint no longer refuses the free tier — it would create a £0 subscription');
  assert.match(link, /ADMINS\.includes/, 'the endpoint is no longer admin-only');
});

console.log(`\n  ${passed} checks passed\n`);
