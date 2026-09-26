// The Premium offline-maps claim, and the switch that can make it a lie again.
//
// src/premium.js opens by naming the two Premium claims that were once untrue.
// The first is "Offline maps — works without signal" when there were no offline
// maps at all: sw.js let tiles pass straight through, and somebody paid £29 a
// year partly for that. It was fixed by building a real tile cache.
//
// Moving the basemap to Google recreates that exact lie by a different route.
// The cache still exists; it is just permanently EMPTY, because sw.js only
// stores OSM and CARTO tiles and Google's terms restrict storing theirs. That
// is the nastiest shape a regression can take: every existing guard still
// passes. The benefit's own `proof` is { file: 'public/sw.js', needle:
// 'TILE_CACHE' } and TILE_CACHE is still right there in the file.
//
// So this file checks the thing the proof cannot: not "does the cache exist"
// but "can it ever hold anything, and if not, have we stopped charging for it".
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { buildTilesCacheable } = await import('../../src/mapTiles.js');
const { PREMIUM_BENEFITS, paidBenefits, benefitAvailable } = await import('../../src/premium.js');

const sw = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');
const app = readFileSync(new URL('../../src/App.jsx', import.meta.url), 'utf8');

const offline = PREMIUM_BENEFITS.find(b => /offline maps/i.test(b.text));

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };

console.log('\nofflineClaim — a cache that cannot fill is not a feature');

it('the worker stores only the tiles we are allowed to store', () => {
  const fn = sw.slice(sw.indexOf('const isTile'), sw.indexOf('const isTile') + 300);
  assert.match(fn, /openstreetmap/, 'OSM tiles are no longer cached');
  // The load-bearing negative. If Google is ever added here it must be a
  // deliberate licence decision, not a quiet one-line "fix" for empty caches.
  assert.ok(!/googleapis|google\.com/.test(fn),
    'Google tiles are being cached — Google Map Tiles terms restrict storing tiles, so this is a licence decision, not a bug fix');
});

it('Google tiles are known to be uncacheable, OSM and CARTO cacheable', () => {
  assert.equal(buildTilesCacheable('google'), false, 'Google tiles are treated as storable');
  assert.equal(buildTilesCacheable('osm'), true, 'OSM tiles are no longer treated as storable');
  assert.equal(buildTilesCacheable('carto'), true, 'CARTO tiles are no longer treated as storable');
});

it('the offline benefit is conditional, not unconditional', () => {
  assert.ok(offline, 'the offline maps benefit is gone');
  assert.equal(offline.needs, 'cacheableTiles',
    'the offline benefit no longer declares that it needs storable tiles — it would be sold regardless of provider');
});

it('it is NOT sold when the tiles cannot be stored', () => {
  // The whole point. This is the assertion that stops £29/year buying an empty
  // cache for the second time.
  const withGoogle = paidBenefits({ cacheableTiles: false });
  assert.ok(!withGoogle.some(b => /offline maps/i.test(b.text)),
    'offline maps is still listed as a paid benefit while the basemap provider forbids storing tiles');
  // And still sold when it genuinely works, or this "fix" just deletes a real feature.
  const withOsm = paidBenefits({ cacheableTiles: true });
  assert.ok(withOsm.some(b => /offline maps/i.test(b.text)),
    'offline maps has been dropped even though the tiles can be stored');
  assert.ok(withOsm.length > withGoogle.length, 'the two cases list the same benefits');
});

it('an unconditional benefit is unaffected by the capability', () => {
  const plain = PREMIUM_BENEFITS.filter(b => !b.needs);
  assert.ok(plain.length >= 3, 'every benefit is now conditional, which is suspicious');
  for (const b of plain) {
    assert.equal(benefitAvailable(b, { cacheableTiles: false }), true,
      `${b.text} was withheld despite needing nothing`);
  }
});

it('the app gates caching and the paywall on the same capability', () => {
  // A benefit hidden from the paywall while the worker is still told to cache
  // (or vice versa) is two answers to one question.
  assert.match(app, /if \(isPremium && tilesCacheable\(\)\) setOfflineMaps\(true\)/,
    'the worker is told to cache without checking whether the tiles may be stored');
  assert.match(app, /paidBenefits\(\{ cacheableTiles: tilesCacheable\(\) \}\)/,
    'the paywall lists paid benefits without checking the capability');
  assert.match(app, /isPremium && tilesCacheable\(\) && \(/,
    'the account menu still says "Offline maps on" when nothing can be stored');
});

it('the install prompt does not promise a map it cannot draw', () => {
  // "Works offline" read as a promise about the whole app, map included. The
  // shell and the spot list are genuinely offline — cached, and the spots ship
  // in the bundle — but tiles are only stored when the licence allows, so the
  // map is the one part that can be blank. The copy now claims only the part
  // that is always true.
  assert.ok(!/Works offline · No App Store/.test(app),
    'the install card promises the app "works offline", which now overstates the map');
  assert.ok(!/home screen — works offline/.test(app),
    'the install banner promises "works offline", which now overstates the map');
  assert.match(app, /Your spots work offline/,
    'the honest offline claim is gone — say what does work rather than nothing');
});

console.log(`\n  ${passed} checks passed\n`);
