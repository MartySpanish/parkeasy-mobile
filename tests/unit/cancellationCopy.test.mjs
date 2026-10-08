// What we tell a driver about cancelling, versus what we actually refund.
//
// The sentence directly under the Pay button read:
//
//   "Free cancellation until 24 hours before your booking. After that, no
//    refund."
//
// That is not what happens. api/bookings/cancel.js refunds
// booking_price_pence + surcharge_pence and KEEPS the driver service fee —
// exactly as the app's own Terms §5.1 says: "the Driver Service Fee is not
// refundable". So on a £23.00 booking a driver cancelling two days ahead got
// £20.00 back, and the line at the moment of payment promised £23.00.
//
// THREE PLACES STATE THIS POLICY and they have to agree: the refund code, the
// Terms, and the checkout copy. Two were right and the one people read was
// wrong. This file is the guard that keeps all three in step, because there is
// no runtime error when they drift — just a consumer-facing price claim
// contradicted by the contract behind it, which is the same class of problem
// as a drip-priced headline.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
/** Source with // comments stripped: a regex must match code, not a note about it. */
const code = p => read(p).split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };

console.log('\ncancellationCopy — the refund we promise is the refund we pay');

const cancel = code('../../api/bookings/cancel.js');
const app = read('../../src/App.jsx');
// JSX comments are {/* … */}, not //, so strip those too before matching copy:
// the block above the sentence quotes the old wrong wording verbatim and would
// otherwise satisfy every assertion in this file.
const appCode = app.replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

//------------------------------------------------------- what the code pays
it('the refund keeps the service fee and returns price plus surcharge', () => {
  // Mutation: add service_fee_pence to the driver branch and the copy below
  // becomes wrong in the other direction.
  assert.match(cancel, /refundPence = \(booking\.booking_price_pence \|\| 0\) \+ \(booking\.surcharge_pence \|\| 0\)/,
    'the driver refund no longer returns booking price + surcharge');
  assert.ok(!/refundPence = .*service_fee_pence/.test(cancel),
    'the service fee is now refunded to a cancelling driver — the checkout copy '
    + 'and Terms §5.1 both say it is not, so all three have to change together');
  // A host cancelling returns everything, including the fee.
  assert.match(cancel, /if \(isHost\) refundPence = booking\.amount_total_pence/,
    'a host cancellation no longer refunds the driver in full');
  assert.match(cancel, /CANCEL_CUTOFF_HOURS \|\| '24'/, 'the 24-hour default moved');
});

//------------------------------------------------------- what the copy says
it('the checkout line no longer promises free cancellation', () => {
  // THE DEFECT. Mutation: put the old sentence back and this fails.
  assert.ok(!/Free cancellation until 24 hours/.test(appCode),
    'the checkout copy claims free cancellation again, while the code keeps the service fee');
  assert.ok(!/free cancellation/i.test(appCode),
    'some surface claims "free cancellation" — no ParkEasy cancellation is free to the driver, '
    + 'because the service fee is retained');
});

it('the checkout line names the two amounts, computed not typed', () => {
  // Naming the figures is what makes the claim checkable against the total
  // printed directly above it. Mutation: hardcode "£3" and a listing with a
  // different fee advertises the wrong number.
  assert.match(appCode, /we refund the £\{bookingCost\.toFixed\(2\)\} parking/,
    'the refundable amount is not derived from bookingCost');
  assert.match(appCode, /£\{serviceFee\.toFixed\(2\)\} service fee isn&rsquo;t refundable/,
    'the retained fee is not derived from serviceFee');
  assert.match(appCode, /you get the full £\{total\.toFixed\(2\)\} back/,
    'the host-cancellation case is not stated, or not derived from total');
  // bookingCost + serviceFee === total, so the three figures reconcile on screen.
  assert.match(appCode, /const total = bookingCost \+ serviceFee;/,
    'the three advertised amounts no longer reconcile');
});

it('"under 24 hours, no refund" is still said', () => {
  // The less flattering half has to stay. Mutation: drop it and the copy
  // becomes selectively true.
  assert.match(appCode, /Under 24 hours, no refund/,
    'the no-refund window is no longer disclosed at the point of payment');
});

//------------------------------------------------------- all three in step
it('the Terms and the FAQ already said it correctly, and still do', () => {
  // These were right before the fix and are the reason the checkout line was
  // provably wrong rather than merely loose.
  assert.match(app, /the Driver Service Fee is <strong[^>]*>not refundable<\/strong>/,
    'Terms §5.1 no longer states the service fee is non-refundable');
  assert.match(app, /the driver service fee is non-refundable/,
    'the FAQ answer no longer states the service fee is non-refundable');
  assert.match(app, /If a host cancels, you get everything back/,
    'the FAQ no longer states the host-cancellation case');
});

it('no surface promises a refund larger than the code pays', () => {
  // A sweep rather than a list, so a NEW surface making the claim fails too.
  // Checked against the whole SENTENCE the phrase sits in, not a forward
  // lookahead. The first version of this used `(?![^.]{0,40}host)` and flagged
  // prerender.mjs's "if a host closes the site we refund in full" — which is
  // accurate, because a host cancellation does refund amount_total_pence
  // including the fee. The qualifier was simply to the LEFT of the phrase.
  const claims = [/full refund/i, /money back guarantee/i, /refund(?:ed)? in full/i];
  /** The sentence containing the match, so a qualifier either side counts. */
  const sentenceAround = (src, idx) => {
    const start = src.lastIndexOf('.', idx) + 1;
    const end = src.indexOf('.', idx);
    return src.slice(start, end === -1 ? src.length : end + 1);
  };
  // A claim is fine when its own sentence says who it applies to or what it
  // excludes: a host cancellation, or the parking price as against the fee.
  const qualified = /host|parking price|booking price|service fee/i;
  const surfaces = {
    'App.jsx (code, JSX comments stripped)': appCode,
    'prerender.mjs': code('../../scripts/prerender.mjs'),
    'inject-area-cta.mjs': code('../../scripts/inject-area-cta.mjs'),
    'inject-destination-pages.mjs': code('../../scripts/inject-destination-pages.mjs'),
    'partners.html': read('../../public/partners.html'),
    'hosts.html': read('../../public/hosts.html'),
  };
  const bad = [];
  for (const [where, src] of Object.entries(surfaces)) {
    for (const re of claims) {
      for (const m of src.matchAll(new RegExp(re.source, 'gi'))) {
        const sentence = sentenceAround(src, m.index);
        if (qualified.test(sentence)) continue;
        bad.push(`${where}: "${sentence.trim().slice(0, 90)}"`);
      }
    }
  }
  assert.deepEqual(bad, [], `an unqualified refund promise reached a public surface: ${bad.join(' | ')}`);
});

console.log(`\n  ${passed} checks passed\n`);
