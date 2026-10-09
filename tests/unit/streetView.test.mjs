// The picture on a spot card: the grey rectangles we paid for, and the fallback
// that could never run.
//
// DEFECT 1 — BILLED FOR GREY. The card built a Street View Static *image* URL
// directly. With no panorama at those coordinates that endpoint answers
// **HTTP 200 with a grey "Sorry, we have no imagery here" image** — so
// `<img onError>` never fires, nothing is logged, the card shows grey, and the
// request is billed because image requests are a metered SKU. Half of
// ParkEasy's inventory is a club car park up a lane or a church yard, which is
// exactly where coverage does not exist.
//
//   Image requests:    billed (Static Street View SKU)
//   Metadata requests: FREE, no quota consumed
//     https://developers.google.com/maps/documentation/streetview/metadata
//
// So asking first costs nothing and stops us buying pictures nobody can use.
//
// DEFECT 2 — THE FALLBACK WAS DEAD CODE. spotImageUrl() documented and
// implemented a keyless OpenStreetMap fallback, and its only caller read
// `GOOGLE_MAPS_KEY ? spotImageUrl(...) : null` — so with no key the caller
// passed null and the keyless branch was unreachable. A deployment without
// VITE_GOOGLE_MAPS_KEY showed no picture on any card.
//
// THE THREE THINGS THAT GO WRONG SILENTLY HERE, all of them cost-shaped:
//   1. Buying an image before metadata has said OK.
//   2. Not caching a NO. Most spots will never have imagery; re-asking about
//      them on every render is a request storm against a free endpoint and a
//      guaranteed one against a billed one if the order is ever reversed.
//   3. Not de-duplicating concurrent cards: ~740 spots, one list, one mount.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  IMAGE_SIZE, osmStaticUrl, metadataUrl, streetViewUrl, hasCoords, hasPanorama,
  coordKey, checkPanorama, knownPanorama, resetPanoramaCache, spotImageNow,
} from '../../src/data/streetView.js';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const app = read('../../src/App.jsx');
const appCode = app.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');

/**
 * The hook's own body, brace-matched out of App.jsx.
 *
 * WHY, AND THE HOLE IT CLOSES. The cleanup assertion below looked for
 * `return () => { live = false; };` anywhere in App.jsx — a string that appears
 * SIXTEEN times in that file. Deleting it from this hook left fifteen behind
 * and the assertion passed, so a mutation removing the hook's own cleanup
 * survived. Scoped to the hook, it bites.
 */
const hookBody = (() => {
  const open = 'const useSpotImage = (lat, lng) => {';
  const at = appCode.indexOf(open);
  assert.notEqual(at, -1, 'useSpotImage is gone from App.jsx');
  let i = appCode.indexOf('{', appCode.indexOf('=>', at)), depth = 0;
  for (let j = i; j < appCode.length; j++) {
    if (appCode[j] === '{') depth++;
    else if (appCode[j] === '}') { depth--; if (depth === 0) return appCode.slice(i, j + 1); }
  }
  throw new Error('unbalanced braces in useSpotImage');
})();
const mod = read('../../src/data/streetView.js')
  .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };
const ita = async (what, fn) => { resetPanoramaCache(); await fn(); passed++; console.log(`  PASS  ${what}`); };

console.log('\nstreetView — we stopped paying for grey rectangles');

const LAT = 54.5934, LNG = -5.9317, KEY = 'test-key';
const resp = (status) => async () => ({ ok: true, json: async () => ({ status }) });
const counting = (status) => { const f = resp(status); const g = async (u) => { g.calls++; g.urls.push(u); return f(u); }; g.calls = 0; g.urls = []; return g; };

// ── 1. Never buy before asking ───────────────────────────────────────────────
it('the first paint is the free map, never a billed image', () => {
  // THE DEFECT. Mutation: return streetViewUrl() here and every card buys an
  // image sight-unseen again.
  const u = spotImageNow(LAT, LNG, KEY);
  assert.ok(u.startsWith('https://staticmap.openstreetmap.de/'),
    `the first paint is not the free map: ${u}`);
  assert.ok(!u.includes('maps.googleapis.com'), 'a billed URL was built before metadata was asked');
});

await ita('ZERO_RESULTS keeps the card on the free map, permanently', async () => {
  const f = counting('ZERO_RESULTS');
  assert.equal(await checkPanorama(LAT, LNG, KEY, f), false);
  const u = spotImageNow(LAT, LNG, KEY);
  assert.ok(u.startsWith('https://staticmap.openstreetmap.de/'),
    `no panorama but the card still points at Street View: ${u}`);
  // And the NO is remembered, so this location is never asked about again.
  assert.equal(knownPanorama(LAT, LNG), false);
  await checkPanorama(LAT, LNG, KEY, f);
  await checkPanorama(LAT, LNG, KEY, f);
  assert.equal(f.calls, 1, `a cached "no" was re-asked ${f.calls} times`);
});

await ita('only status OK upgrades to Street View', async () => {
  const f = counting('OK');
  assert.equal(await checkPanorama(LAT, LNG, KEY, f), true);
  const u = spotImageNow(LAT, LNG, KEY);
  assert.ok(u.startsWith('https://maps.googleapis.com/maps/api/streetview?'),
    `metadata said OK but the card did not upgrade: ${u}`);
  assert.ok(u.includes(`location=${LAT},${LNG}`) && u.includes(`size=${IMAGE_SIZE}`));
  assert.ok(f.urls[0].includes('/streetview/metadata?'), 'the free endpoint was not the one asked');
});

it('every non-OK status is treated as no imagery', () => {
  // REQUEST_DENIED is a bad key, an unenabled API or billing off; OVER_QUERY_LIMIT
  // is the free cap. Buying an image in any of those states is money for a
  // guaranteed error rectangle.
  for (const s of ['ZERO_RESULTS', 'REQUEST_DENIED', 'OVER_QUERY_LIMIT', 'INVALID_REQUEST', 'UNKNOWN_ERROR', '']) {
    assert.equal(hasPanorama({ status: s }), false, `${s} was treated as a panorama`);
  }
  assert.equal(hasPanorama({ status: 'OK' }), true);
  assert.equal(hasPanorama(null), false);
  assert.equal(hasPanorama(undefined), false);
  assert.equal(hasPanorama({}), false);
});

// ── 2. The failures must all land on a working map ───────────────────────────
await ita('a failing, blocked or non-JSON metadata call keeps the map', async () => {
  for (const [name, f] of [
    ['throws',     async () => { throw new Error('offline'); }],
    ['not ok',     async () => ({ ok: false, status: 403, json: async () => ({}) })],
    ['bad json',   async () => ({ ok: true, json: async () => { throw new Error('not json'); } })],
    ['no body',    async () => null],
  ]) {
    resetPanoramaCache();
    // RESOLVES, never rejects: an unhandled rejection in a render effect is a
    // console full of noise and, with no catch anywhere, a wedged entry.
    assert.equal(await checkPanorama(LAT, LNG, KEY, f), false, `${name} did not resolve false`);
    assert.ok(spotImageNow(LAT, LNG, KEY).startsWith('https://staticmap.'),
      `${name} left the card off the free map`);
    // The NO is recorded, so the failure is not retried on every re-render.
    assert.equal(knownPanorama(LAT, LNG), false, `${name} did not cache its failure`);
    // And asking again does not re-request: proof the in-flight entry was
    // cleared rather than left behind.
    const again = counting('OK');
    assert.equal(await checkPanorama(LAT, LNG, KEY, again), false,
      `${name} re-asked and changed its answer`);
    assert.equal(again.calls, 0, `${name} left a wedged in-flight entry`);
  }
});

await ita('a non-2xx response is not trusted, whatever its body says', async () => {
  // THE CONTRACT THE res.ok GUARD STATES. In practice a Google error carries a
  // non-OK `status` too, so removing the guard changes nothing for a real
  // response — which is exactly why it needs pinning here rather than being
  // left as a line nobody can prove is load-bearing. A 429, a 500 or anything
  // served by something in the middle must not be able to authorise a billed
  // image request.
  for (const status of [403, 429, 500, 502]) {
    resetPanoramaCache();
    const f = async () => ({ ok: false, status, json: async () => ({ status: 'OK' }) });
    assert.equal(await checkPanorama(LAT, LNG, KEY, f), false,
      `HTTP ${status} with an OK body was trusted`);
    assert.ok(spotImageNow(LAT, LNG, KEY).startsWith('https://staticmap.'),
      `HTTP ${status} upgraded the card to a billed image`);
  }
});

await ita('no key means the free map, not a null', async () => {
  // DEFECT 2. The old caller gate made this unreachable; a keyless deployment
  // showed no picture at all.
  for (const k of ['', null, undefined]) {
    const u = spotImageNow(LAT, LNG, k);
    assert.ok(u && u.startsWith('https://staticmap.openstreetmap.de/'),
      `no key produced ${JSON.stringify(u)} instead of the free map`);
    assert.equal(await checkPanorama(LAT, LNG, k, counting('OK')), false,
      'metadata was requested without a key');
  }
});

it('a spot with no usable position shows no picture at all', () => {
  // Number(null) is 0 and 0,0 is the Gulf of Guinea — a card must show its icon
  // rather than the Atlantic. Same Number(null) trap as distanceLabel() and
  // median(); third time in this codebase.
  for (const [a, b] of [[null, null], [undefined, undefined], [0, 0], ['x', 'y'], [NaN, 1], [91, 0], [0, 181]]) {
    assert.equal(hasCoords(a, b), false, `hasCoords(${a},${b}) is true`);
    assert.equal(spotImageNow(a, b, KEY), null, `spotImageNow(${a},${b}) built a URL`);
  }
  assert.equal(hasCoords(LAT, LNG), true);
  assert.equal(hasCoords(0, -5.9), true, 'a real zero latitude was rejected');
});

// ── 3. One request, however many cards ───────────────────────────────────────
await ita('N cards at the same spot make ONE metadata request', async () => {
  // ~740 spots in one list, re-rendered on every keystroke, filter and sort.
  const f = counting('OK');
  const out = await Promise.all(Array.from({ length: 12 }, () => checkPanorama(LAT, LNG, KEY, f)));
  assert.deepEqual(out, Array(12).fill(true));
  assert.equal(f.calls, 1, `12 concurrent cards made ${f.calls} requests`);
});

it('the cache key is per location, about a metre', () => {
  assert.equal(coordKey(LAT, LNG), '54.59340,-5.93170');
  assert.equal(coordKey(54.593401, -5.931701), coordKey(LAT, LNG), 'sub-metre jitter split the cache');
  assert.notEqual(coordKey(54.5934, -5.9317), coordKey(54.5944, -5.9317), 'two spots share one answer');
});

// ── The URLs themselves ──────────────────────────────────────────────────────
it('the key is URL-encoded and both providers are asked for the same size', () => {
  assert.ok(metadataUrl(LAT, LNG, 'a b&c=d').includes('key=a%20b%26c%3Dd'),
    'the key is not encoded on the metadata call');
  assert.ok(streetViewUrl(LAT, LNG, 'a b&c=d').includes('key=a%20b%26c%3Dd'),
    'the key is not encoded on the image call');
  // THE SIZE IS PINNED TO A LITERAL, NOT TO IMAGE_SIZE. The first version of
  // this asserted `includes(\`size=${IMAGE_SIZE}\`)`, which is the constant
  // compared against itself — changing IMAGE_SIZE moved both sides and the
  // assertion passed. A mutation to '300x150' survived it.
  assert.equal(IMAGE_SIZE, '600x300', 'the card image size changed — check the layout still fits');
  assert.ok(osmStaticUrl(LAT, LNG).includes('size=600x300'), 'the free map size changed');
  assert.ok(streetViewUrl(LAT, LNG, KEY).includes('size=600x300'), 'the Street View size changed');
  // And they must agree, or the upgrade is a visible resize mid-scroll.
  const sizeOf = (u) => (u.match(/size=(\d+x\d+)/) || [])[1];
  assert.equal(sizeOf(osmStaticUrl(LAT, LNG)), sizeOf(streetViewUrl(LAT, LNG, KEY)),
    'the two providers are asked for different sizes');
});

it('the metadata endpoint is the free one, and the image one is never it', () => {
  assert.match(metadataUrl(LAT, LNG, KEY), /\/maps\/api\/streetview\/metadata\?/);
  assert.ok(!/\/metadata\?/.test(streetViewUrl(LAT, LNG, KEY)));
  // The host must be the documented one; mt0.google.com and friends are a
  // terms-of-service breach that suspends the key — the same rule
  // mapTiles.test.mjs enforces for basemap tiles.
  for (const u of [metadataUrl(LAT, LNG, KEY), streetViewUrl(LAT, LNG, KEY)]) {
    assert.ok(u.startsWith('https://maps.googleapis.com/'), `undocumented host: ${u}`);
  }
  assert.ok(!/mt\d?\.google\.com|khms\d?\.google|lyrs=/.test(mod),
    'an internal Google tile host appeared — that suspends the API key');
});

// ── The wiring in App.jsx ────────────────────────────────────────────────────
it('the card uses the hook, and the dead gate is gone', () => {
  assert.match(appCode, /const spotImg = useSpotImage\(spot\.lat, spot\.lng\);/,
    'the card no longer uses the hook');
  assert.match(appCode, /const img = spot\.photo \|\| spotImg;/, 'the card does not fall back to the hook');
  // THE GATE THAT MADE THE FALLBACK UNREACHABLE.
  assert.ok(!/GOOGLE_MAPS_KEY \? spotImageUrl/.test(appCode),
    'the GOOGLE_MAPS_KEY gate is back — the keyless fallback is unreachable again');
  // And no surface builds a Street View URL by hand any more.
  assert.ok(!/maps\/api\/streetview/.test(appCode),
    'App.jsx builds a Street View URL directly, bypassing the metadata check');
});

it('the hook re-seeds on a coordinate change and cannot set state after unmount', () => {
  // ASSERTED AGAINST hookBody, NOT THE WHOLE FILE — see its definition above.
  // A recycled card must not show the previous spot's Street View while the new
  // location is still being checked.
  assert.ok(hookBody.length > 200, `the brace match returned ${hookBody.length} chars — it failed`);
  assert.match(hookBody, /setUrl\(spotImageNow\(lat, lng, GOOGLE_MAPS_KEY\)\);\s*\n\s*if \(!GOOGLE_MAPS_KEY/,
    'the hook no longer re-seeds the URL when the coordinates change');
  assert.match(hookBody, /if \(live\) setUrl\(spotImageNow\(lat, lng, GOOGLE_MAPS_KEY\)\);/,
    'the hook sets state without checking it is still mounted');
  assert.match(hookBody, /return \(\) => \{ live = false; \};/,
    "the hook's cleanup is gone — it will set state after unmount");
  assert.match(hookBody, /\}, \[lat, lng\]\);/, 'the effect no longer depends on the coordinates');
  // Already-settled locations must not re-ask on mount.
  assert.match(hookBody, /if \(knownPanorama\(lat, lng\) !== undefined\) return undefined;/,
    'a settled location is asked about again on every mount');
});

it('the OSM static host is in the site CSP', () => {
  // The free map is only free if it renders. staticmap.openstreetmap.de has to
  // be in img-src or every card draws a broken image instead.
  const vercel = read('../../vercel.json');
  assert.match(vercel, /https:\/\/staticmap\.openstreetmap\.de/,
    'the OpenStreetMap static host is not in img-src — the fallback cannot draw');
  assert.match(vercel, /https:\/\/maps\.googleapis\.com/, 'maps.googleapis.com is not in img-src');
});

console.log(`\n  ${passed} checks passed\n`);
