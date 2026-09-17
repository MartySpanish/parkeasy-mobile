// Event-day pricing: the money side.
//
// The table and the checkout path have worked all along — nothing ever wrote a
// row. So the failures worth guarding are the ones that put a wrong number in
// front of a driver, or change a host's price without them agreeing to it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const checkout = read('../../api/checkout/create-session.js');
const admin    = read('../../api/admin.js');
const app      = read('../../src/App.jsx');
const mig      = read('../../supabase/migrations/20260907_event_pricing.sql');

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };

console.log('\neventPricing — a higher price has to say why');

it('the driver is told what the higher price is for', () => {
  // A raised price with no explanation reads as a mistake or a sting.
  assert.match(checkout, /overrideLabel = o\.label \|\| null/, 'the override label is no longer read');
  assert.match(checkout, /description: overrideLabel \|\| listing\.address/,
    'the checkout line no longer shows the event — a driver sees a higher price with no reason');
  assert.match(checkout, /select=price_pence,label/, 'the label is not fetched with the price');
});

it('nothing is applied automatically', () => {
  // The host agreed a price. Raising it is a decision somebody makes once,
  // with their nod — not something a screen does on load.
  assert.match(app, /applyEventPrice/, 'the apply handler is gone');
  const load = app.slice(app.indexOf('const loadEvp'), app.indexOf('const applyEventPrice'));
  assert.ok(!/set-event-price/.test(load),
    'loading the suggestions writes prices — that changes a host\'s money without asking');
});

it('a fat finger cannot put an absurd price in front of a driver', () => {
  const block = admin.slice(admin.indexOf("'set-event-price'"), admin.indexOf("'set-event-price'") + 1600);
  assert.match(block, /pricePence > 50000/, 'the sanity ceiling is gone');
  assert.match(block, /!\(pricePence > 0\)/, 'a zero or negative price is accepted');
  assert.match(block, /p\.listingId \|\| !p\.date/, 'the endpoint no longer requires a listing and a date');
});

it('setting a price twice updates rather than failing', () => {
  // (listing_id, override_date) is unique. A plain insert would 409 the second
  // time somebody adjusts a matchday price.
  const block = admin.slice(admin.indexOf("'set-event-price'"), admin.indexOf("'set-event-price'") + 1600);
  assert.match(block, /on_conflict=listing_id,override_date/, 'the upsert conflict target is gone');
  assert.match(block, /resolution=merge-duplicates/, 'a second price change would fail with a conflict');
});

it('the label is snapshotted, not looked up later', () => {
  // An event can be renamed or deleted. What somebody was charged for cannot
  // change after the fact.
  assert.match(mig, /add column if not exists label text/, 'the label column is gone');
  assert.match(mig, /on delete set null/,
    'deleting an event cascades away a price somebody may already have paid');
  // Anchored to the REQUEST payload. "label:" is a substring of
  // "existing_label:", which the optimistic UI patch two lines below also sets
  // — so the loose version matched that instead and passed with the real label
  // set to null. It took a mutation to find, which is the point of running them.
  assert.match(app, /eventId: row\.event_id, label: `Event pricing — \$\{row\.event\}`/,
    'the label sent to the server no longer names the event — the driver would see a bare higher price');
});

it('the radius is 2km, and that is a measured decision', () => {
  assert.match(mig, /p_radius_m integer default 2000/,
    'the radius default changed — at 1500m there is nothing to suggest, measured against the live listings');
  assert.match(mig, /greatest\(200, least\(p_radius_m, 20000\)\)/,
    'the radius is unbounded — a caller could ask for the whole country');
  assert.match(admin, /Math\.max\(200, Math\.min\(Number\(p\.radiusM\) \|\| 2000, 20000\)\)/,
    'the endpoint no longer bounds the radius it passes through');
});

it('an empty result is explained, not left blank', () => {
  // Zero suggestions is a supply gap, not a bug, and the screen should say so
  // rather than looking broken.
  assert.match(app, /That is a supply gap, not a bug/,
    'an empty suggestion list no longer explains itself');
});

console.log(`\n  ${passed} checks passed\n`);
