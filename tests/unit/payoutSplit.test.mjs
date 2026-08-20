// Who gets what, when the split isn't the standard 15%.
//
// priceBreakdown is the one place that decides how a booking divides. Invoice
// mode gives it a second rate, and the danger of a second rate is that it leaks
// into the first: every club, church and school in the product is on 85/15,
// that number is in signed agreements, and a bug here underpays them silently
// and forever.
import assert from 'node:assert/strict';
import { priceBreakdown, HOST_COMMISSION } from '../../api/_pricing.js';

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };

console.log('\npayoutSplit — the standard split, and the negotiated one');

it('an ordinary booking is untouched: host keeps 85%', () => {
  const m = priceBreakdown(2000);
  assert.equal(m.commissionPence, 300);
  assert.equal(m.hostReceivesPence, 1700);
  assert.equal(m.commissionRate, HOST_COMMISSION);
});

it('a missing rate means the standard split, not a free booking', () => {
  // Number(null) is 0, so a null read straight out of a database column would
  // have made our commission zero and handed the whole space price away.
  for (const bad of [undefined, null, '', NaN, 'abc']) {
    const m = priceBreakdown(2000, {}, { commissionRate: bad });
    assert.equal(m.hostReceivesPence, 1700, `commissionRate=${String(bad)} changed the standard split`);
  }
});

it('an operator on 70% gets 70% of the space price', () => {
  // What checkout passes for an invoice listing: 1 - operator_share_pct/100.
  const m = priceBreakdown(2000, {}, { commissionRate: 1 - 70 / 100 });
  assert.equal(m.hostReceivesPence, 1400);
  assert.equal(m.commissionPence, 600);
});

it('the driver pays the same either way', () => {
  const club = priceBreakdown(2000);
  const operator = priceBreakdown(2000, {}, { commissionRate: 0.30 });
  assert.equal(club.totalPence, operator.totalPence);
  assert.equal(club.serviceFeePence, operator.serviceFeePence);
});

it('nothing ever adds up to more or less than the driver paid', () => {
  for (const price of [400, 999, 1550, 2000, 12345]) {
    for (const rate of [undefined, 0, 0.15, 0.3, 0.5, 1]) {
      const m = priceBreakdown(price, {}, { commissionRate: rate, surchargePence: 1000, surchargeCommissionRate: 0.15 });
      assert.equal(
        m.applicationFeePence + m.hostReceivesPence,
        m.totalPence,
        `£${price / 100} at rate ${rate}: the two sides don't sum to the total`,
      );
    }
  }
});

it('a rate outside 0–1 is clamped rather than paying a negative amount', () => {
  assert.equal(priceBreakdown(2000, {}, { commissionRate: 5 }).hostReceivesPence, 0);
  assert.equal(priceBreakdown(2000, {}, { commissionRate: -3 }).hostReceivesPence, 2000);
});

it('the overnight fee still follows the site agreement, not the split', () => {
  // Belfast Royal Academy's clause 5: the fee is paid to the Academy in full.
  // Changing our share of the SPACE price must not touch it.
  const m = priceBreakdown(2000, {}, { commissionRate: 0.30, surchargePence: 1000, surchargeCommissionRate: 0 });
  assert.equal(m.surchargeCommissionPence, 0);
  assert.equal(m.hostReceivesPence, 1400 + 1000);
});

console.log(`  ${passed} checks passed`);
