// The rule that decides whether a driver sees a paid alternative at all.
//
// Pure logic, so it is testable without a browser — and worth testing, because
// the failure mode is silent: get it slightly wrong and every free spot in the
// app grows an advert, which is exactly what this feature is trying not to be.
import assert from 'node:assert/strict';
import { paidAlternativeFor, NEARBY_RADIUS_M } from '../../src/data/hotspotFunnel.js';

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };

const sellable = () => true;
const allIn = (h, d) => ({ total: (d ?? h ?? 0) });

// Roughly 400m and 1200m east of the free spot.
const free = { id: 1, badge: 'free', name: 'Sydenham Road layby', lat: 54.6000, lng: -5.9000, walk: '12 min walk' };
const near = { id: 2, rental: true, name: 'Lanyon Place', lat: 54.6000, lng: -5.8938, listing: { price_per_day: 20 } };
const far  = { id: 3, rental: true, name: 'Somewhere else',  lat: 54.6000, lng: -5.8815, listing: { price_per_day: 12 } };

console.log('\nhotspotFunnel — when a paid alternative is offered');

it('offers the nearest bookable space inside the radius', () => {
  const r = paidAlternativeFor(free, [near, far], {}, sellable, allIn);
  assert.equal(r.spot.name, 'Lanyon Place');
  assert.ok(r.distanceM < NEARBY_RADIUS_M);
});

it('picks NEAREST, not cheapest — the driver is standing somewhere specific', () => {
  const cheapFar = { ...far, lat: 54.6000, lng: -5.8940, listing: { price_per_day: 2 } };
  const r = paidAlternativeFor(free, [near, cheapFar], {}, sellable, allIn);
  assert.ok(['Lanyon Place', 'Somewhere else'].includes(r.spot.name));
  const others = [near, cheapFar].map(s => Math.hypot((free.lat - s.lat) * 111320, (free.lng - s.lng) * 65000));
  assert.ok(r.distanceM <= Math.max(...others));
});

it('offers nothing when the only bookable space is too far', () => {
  assert.equal(paidAlternativeFor(free, [far], {}, sellable, allIn), null);
});

it('offers nothing on a spot that is itself bookable', () => {
  assert.equal(paidAlternativeFor({ ...free, rental: true }, [near], {}, sellable, allIn), null);
});

it('offers nothing on a paid council car park — already a paid choice', () => {
  assert.equal(paidAlternativeFor({ ...free, badge: 'paid' }, [near], {}, sellable, allIn), null);
});

it('offers nothing when the listing is not actually sellable', () => {
  assert.equal(paidAlternativeFor(free, [near], {}, () => false, allIn), null);
});

console.log('\n  reason, which decides the heading');
it('"taken" when every space we can see is claimed', () => {
  assert.equal(paidAlternativeFor(free, [near], { atCapacity: true }, sellable, allIn).reason, 'taken');
});
it('"contested" when somebody else is on the way', () => {
  assert.equal(paidAlternativeFor(free, [near], { contested: true, others: 1 }, sellable, allIn).reason, 'contested');
});
it('"nearby" when nothing is wrong with the free spot', () => {
  assert.equal(paidAlternativeFor(free, [near], {}, sellable, allIn).reason, 'nearby');
});
it('atCapacity beats contested — the stronger fact wins the heading', () => {
  assert.equal(paidAlternativeFor(free, [near], { atCapacity: true, contested: true }, sellable, allIn).reason, 'taken');
});

console.log(`\n${passed} checks passed\n`);
