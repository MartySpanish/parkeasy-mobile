// The free → paid funnel, and the one sentence it must never say.
//
// This app exists to stop somebody driving past an empty space. We see ParkEasy
// users and nobody else, so two of our drivers parked on a twelve-space street
// says nothing about the other ten. The brief asks for a "Likely full" chip on
// exactly that case; the signal is right and the claim is not, and most of what
// follows is about keeping those apart.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import claimState from '../../src/data/spotClaims.js';
import { paidAlternativeFor, NEARBY_RADIUS_M } from '../../src/data/hotspotFunnel.js';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const card  = read('../../src/components/funnel/ComparisonCard.jsx');
const claims = read('../../src/data/spotClaims.js');

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };

const gem = (extra = {}) => ({ id: 1, badge: 'hidden_gem', lat: 54.59, lng: -5.93, ...extra });
const paid = [{ id: 'rental-x', rental: true, lat: 54.591, lng: -5.931, listing: { id: 'x', price_per_hour: 3 } }];

console.log('\nhotspotFunnel — warn the driver without claiming a fact we cannot see');

it('two drivers parked on a spot with no recorded capacity is a signal', () => {
  // 46 of 133 published gems have no capacity, so atCapacity can never fire for
  // them and this is the only warning available.
  assert.equal(claimState(gem({ inUse: 2 })).crowded, true, 'two parked is not flagged');
  assert.equal(claimState(gem({ inUse: 1 })).crowded, false, 'one parked driver is not a crowd');
  assert.equal(claimState(gem({ inUse: 0 })).crowded, false, 'an empty spot is flagged as crowded');
});

it('it defers to a known capacity rather than duplicating it', () => {
  // Where the capacity IS recorded, atCapacity is the better answer and this
  // would just be a weaker, noisier version of it.
  assert.equal(claimState(gem({ inUse: 2, spaces: 20 })).crowded, false,
    'crowded fires on a twenty-space car park with two cars in it');
  assert.equal(claimState(gem({ inUse: 4, spaces: 4 })).atCapacity, true,
    'a known capacity no longer produces atCapacity');
});

// Comments stripped: both // lines and {/* */} JSX blocks. This file EXPLAINS
// in prose that it must never claim a spot is full, so a check looking for that
// phrase matches the explanation and fails on its own documentation. That has
// now caught me four times in this session; stripping first is the habit.
const codeOnly = (src) => src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

it('nothing anywhere claims the spot is FULL', () => {
  // The wording is the whole point. "Likely full" is a claim about the world;
  // "two drivers are parked here" is what we can actually see.
  const visible = codeOnly(card);
  assert.ok(!/likely full/i.test(visible), 'the card claims a spot is likely full');
  assert.ok(!/\bis full\b/i.test(visible), 'the card claims a spot is full');
  assert.match(card, /drivers are parked here right now/,
    'the crowded heading no longer says what we actually know');
  // The reasoning is recorded where the next person will look for it.
  // Matched on one line: the note wraps mid-sentence, so a phrase spanning the
  // break never matches however correct the prose is.
  assert.match(claims, /the signal ships and the claim does not/,
    'the note explaining why this is not called "likely full" is gone');
});

it('the signal reaches the card as its own reason', () => {
  const claim = claimState(gem({ inUse: 2 }));
  const alt = paidAlternativeFor(gem({ inUse: 2 }), paid, claim);
  assert.ok(alt, 'no paid alternative was offered');
  assert.equal(alt.reason, 'crowded', `reason was "${alt.reason}" — the crowded case is not reaching the card`);
});

it('a stronger signal outranks a weaker one', () => {
  // atCapacity is a fact about a known capacity; crowded is drivers parked on a
  // spot of unknown size; contested is somebody merely on their way.
  const full = paidAlternativeFor(gem({ inUse: 4, spaces: 4 }), paid, claimState(gem({ inUse: 4, spaces: 4 })));
  assert.equal(full.reason, 'taken', 'a genuinely full spot is downgraded to crowded');
  const onWay = paidAlternativeFor(gem({ onWay: 1 }), paid, claimState(gem({ onWay: 1 })));
  assert.equal(onWay.reason, 'contested', 'somebody on their way no longer reads as contested');
});

it('the radius reaches far enough to have a candidate at all', () => {
  // At 800m, with three active listings, most free spots had no candidate and
  // the funnel simply never appeared — the same problem the event-pricing
  // radius had.
  assert.equal(NEARBY_RADIUS_M, 1000, `the radius is ${NEARBY_RADIUS_M}m`);
  const far = [{ ...paid[0], lat: 54.60, lng: -5.94 }];   // ~1.3km away
  assert.equal(paidAlternativeFor(gem(), far, {}), null, 'a space over a kilometre away is still offered');
});

it('the tap is counted, not just the booking', () => {
  // bookings.from_hotspot only records the ones who paid. Without the tap the
  // drop-off — the interesting half — is invisible.
  assert.match(card, /track\('hotspot_to_booking_tap'/, 'the tap is no longer counted');
  // With the spot id, since that is what makes the booking attributable to
  // THIS hotspot rather than to "a free spot".
  assert.match(card, /markHotspotOrigin\(spot\?\.id\)/,
    'the booking would no longer be attributed to the free spot');
});

it('the free option is still shown first, and fairly', () => {
  // The free spots are why people open the app. A comparison that quietly makes
  // them look worse sells one booking and loses the reason anybody came.
  const freeAt = card.indexOf('THE FREE OPTION');
  const paidAt = card.indexOf('THE PAID OPTION');
  assert.ok(freeAt > 0 && paidAt > 0 && freeAt < paidAt, 'the paid option is now rendered first');
  assert.match(card, /Still free to try/, 'the line telling them to look at the free one first is gone');
});

// ── Per-hotspot attribution ─────────────────────────────────────────────────
//
// bookings.from_hotspot was a boolean: it said a booking came from a free spot
// but not WHICH one, so "which gems actually produce bookings" could not be
// asked. These guard the chain that carries the spot id from the tap to the
// booking row — and every link in it is silent when it breaks.
const funnelSrc  = read('../../src/funnel.js');
const notifySrc  = read('../../src/notify.js');
const checkout   = read('../../api/checkout/create-session.js');

it('the mark carries which spot, not just when', () => {
  assert.match(funnelSrc, /export const markHotspotOrigin = \(spotId = null\)/,
    'markHotspotOrigin no longer takes a spot id');
  assert.match(funnelSrc, /export const hotspotOriginSpot = \(\)/, 'the spot id cannot be read back');
  assert.match(card, /markHotspotOrigin\(spot\?\.id\)/,
    'the card marks the origin without the spot — every booking would be attributed to "a free spot"');
});

it('a session already mid-journey does not lose its attribution on deploy', () => {
  // The old key held a bare timestamp. Somebody who tapped the card before this
  // shipped and pays after it must still count.
  assert.match(funnelSrc, /const LEGACY_KEY = 'pe_from_hotspot_at'/, 'the legacy key is no longer read');
  assert.match(funnelSrc, /sessionStorage\.removeItem\(LEGACY_KEY\)/,
    'clearing the mark leaves the legacy key behind, so one card could claim a second booking');
});

it('the TTL is applied in exactly one place', () => {
  // Two readers means the window gets enforced in one and forgotten in the
  // other, and an attribution that never expires eventually claims everything.
  assert.match(funnelSrc, /const readOrigin = \(\) =>/, 'the single reader is gone');
  assert.equal((funnelSrc.match(/HOTSPOT_ORIGIN_TTL_MS/g) || []).length, 3,
    'the TTL is referenced somewhere other than its definition and the one reader');
});

it('the spot id reaches the server and is not trusted on arrival', () => {
  assert.match(notifySrc, /fromHotspotSpotId: hotspotOriginSpot\(\)/, 'checkout is no longer told which spot');
  assert.match(checkout, /from_hotspot_spot_id: i === 0 \? fromHotspotSpotId : null/,
    'the booking row no longer records which spot');
  // It is a client string landing in a column the admin screen groups by.
  assert.match(checkout, /replace\(\/\[\^A-Za-z0-9_-\]\/g, ''\)\.slice\(0, 64\)/,
    'the spot id is stored unsanitised');
  // Only when the booking actually came from a hotspot, or the column fills
  // with ids from bookings that had nothing to do with one.
  assert.match(checkout, /const fromHotspotSpotId = fromHotspot/,
    'the spot id is recorded even when the booking did not come from a hotspot');
});

console.log(`\n  ${passed} checks passed\n`);
