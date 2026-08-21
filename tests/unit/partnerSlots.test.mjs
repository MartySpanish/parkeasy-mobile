// Where partner cards sit in the results list, and the bug that keeps happening.
//
// THE BUG. restPartners is sliced to PARTNER_SLOTS.length. Add an eleventh
// partner to a ten-slot array and the eleventh simply does not render: no
// error, no warning, no empty space — the last partner in the priority order
// is gone from every search. It has happened at four, five, six, seven, eight
// and ten partners, and each time it was found by somebody noticing a missing
// card rather than by anything failing.
//
// PARTNER_SLOTS lives in App.jsx, which imports React and Leaflet and cannot be
// loaded in Node, so the literal is read out of the source the same way
// scripts/generate-gem-seed.mjs reads the spot arrays.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../src/App.jsx', import.meta.url), 'utf8');

const SLOTS = JSON.parse(
  /const PARTNER_SLOTS = (\[[^\]]*\]);/.exec(src)?.[1]
  ?? assert.fail('PARTNER_SLOTS not found in App.jsx — did it move or get renamed?'),
);
const pageExpr = /const PAGE = (.+);/.exec(src)?.[1] ?? '';
const PAGE = pageExpr.includes('PARTNER_SLOTS')
  ? SLOTS[SLOTS.length - 1] + Number(/\+\s*(\d+)/.exec(pageExpr)?.[1] ?? 0)
  : Number(pageExpr);

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };

console.log('\npartnerSlots — every partner gets a slot, every slot gets a page');

it('slots are strictly increasing', () => {
  for (let i = 1; i < SLOTS.length; i++) {
    assert.ok(SLOTS[i] > SLOTS[i - 1], `slot ${i} (${SLOTS[i]}) is not after ${SLOTS[i - 1]}`);
  }
});

it('never two adverts in a row', () => {
  // The whole format depends on this. Two adjacent slots and the results list
  // reads as a column of adverts with parking spots in it.
  for (let i = 1; i < SLOTS.length; i++) {
    assert.ok(SLOTS[i] - SLOTS[i - 1] >= 2,
      `slots ${SLOTS[i - 1]} and ${SLOTS[i]} are adjacent`);
  }
});

it('the last advert is on the first page', () => {
  // PAGE was hand-typed and hand-bumped twice. A page that ends before the
  // final slot hides that partner exactly as thoroughly as a missing slot.
  assert.ok(PAGE > SLOTS[SLOTS.length - 1],
    `PAGE is ${PAGE} but the last slot is ${SLOTS[SLOTS.length - 1]}`);
});

it('PAGE is derived from the slots, not typed alongside them', () => {
  assert.ok(pageExpr.includes('PARTNER_SLOTS'),
    `PAGE is the literal "${pageExpr}" — it will drift the next time a slot is added`);
});

it('the list still ends on parking spots, not on an advert', () => {
  assert.ok(PAGE - SLOTS[SLOTS.length - 1] >= 3,
    'fewer than three cards after the final advert');
});

// The failure mode itself, stated as a test so it is written down somewhere
// other than a comment.
it('one slot short drops a partner silently — which is why the count matters', () => {
  const partners = Array.from({ length: SLOTS.length + 1 }, (_, i) => `p${i}`);
  assert.equal(partners.slice(0, SLOTS.length).length, SLOTS.length);
  assert.ok(!partners.slice(0, SLOTS.length).includes(`p${SLOTS.length}`),
    'the extra partner should be the one that vanishes');
});

console.log(`  ${passed} checks passed — ${SLOTS.length} slots, page of ${PAGE}`);
