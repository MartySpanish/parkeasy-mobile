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
// DEFECT 2 — THE REPLACEMENT PROVIDER DID NOT EXIST. The fix for defect 1
// painted a free map first and upgraded to Street View only once metadata said
// OK, so no card was ever blank or grey. That free map was
// staticmap.openstreetmap.de, and the OpenStreetMap wiki marks that hosted
// service DISCONTINUED — past tense, self-host instead — while the OSM help
// answer that recommended it said it is not a production service for
// commercial applications. Only 8 of ~790 spots carry a real photo, so nearly
// every card fired a request at a dead host, the `<img>` failed, and the card
// fell through to its icon. "Always show a free map" delivered no map and one
// doomed request per card.
//
// DEFECT 3 — A DISABLED API COST A REQUEST PER SPOT. Every non-OK status was
// treated as "no imagery HERE" and cached per location. But REQUEST_DENIED is
// a fact about the KEY, not about a location, and it is the answer for all
// ~790 of them. A key Google is refusing produced a metadata request per spot
// per session, every one guaranteed to be refused. See KEY_REFUSALS.
//
// THE FOUR THINGS THAT GO WRONG SILENTLY HERE, all of them cost-shaped:
//   1. Buying an image before metadata has said OK.
//   2. Not caching a NO. Most spots will never have imagery; re-asking about
//      them on every render is a request storm against a free endpoint and a
//      guaranteed one against a billed one if the order is ever reversed.
//   3. Not de-duplicating concurrent cards: ~790 spots, one list, one mount.
//   4. Treating a key-level refusal as a per-location answer.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  IMAGE_SIZE, metadataUrl, streetViewUrl, hasCoords, hasPanorama,
  coordKey, checkPanorama, knownPanorama, resetPanoramaCache, spotImageNow,
  KEY_REFUSALS, KEY_REFUSAL_HTTP, isKeyRefusal, keyRefused,
} from '../../src/data/streetView.js';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const app = read('../../src/App.jsx');
// COMMENTS OUT, INCLUDING BLOCK ONES. This stripper used to drop JSX comments
// and `//` lines only, which left every /** */ doc block in place — so an
// assertion that "App.jsx must not mention the retired host" was satisfied by
// the doc comment explaining that the host was retired. Same class of bug as
// the area-page sweep that matched a file's own comment instead of its code.
const appCode = app
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

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

console.log('\nstreetView — grey rectangles, then a provider that had closed');

const LAT = 54.5934, LNG = -5.9317, KEY = 'test-key';
const resp = (status) => async () => ({ ok: true, json: async () => ({ status }) });
const counting = (status) => { const f = resp(status); const g = async (u) => { g.calls++; g.urls.push(u); return f(u); }; g.calls = 0; g.urls = []; return g; };

// ── 1. Never buy before asking ───────────────────────────────────────────────
it('the first paint buys nothing — there is no confirmed panorama yet', () => {
  // THE DEFECT. Mutation: return streetViewUrl() here and every card buys an
  // image sight-unseen again.
  resetPanoramaCache();
  const u = spotImageNow(LAT, LNG, KEY);
  assert.equal(u, null, `the first paint built a URL before metadata was asked: ${u}`);
});

it('no surface anywhere still points at the discontinued static map host', () => {
  // DEFECT 2. The whole point: this string must not come back. It is checked
  // against the module source as well as the built URL, because a helper that
  // is exported but unused is a helper somebody re-wires in six months.
  assert.ok(!/staticmap\.openstreetmap\.de/.test(mod),
    'the retired OpenStreetMap static map service is referenced again');
  assert.ok(!/osmStaticUrl/.test(mod), 'the dead provider\'s URL builder is back');
  assert.ok(!/staticmap/.test(appCode), 'App.jsx references the retired static map service');
});

await ita('ZERO_RESULTS leaves the card with no picture, permanently', async () => {
  const f = counting('ZERO_RESULTS');
  assert.equal(await checkPanorama(LAT, LNG, KEY, f), false);
  const u = spotImageNow(LAT, LNG, KEY);
  assert.equal(u, null, `no panorama but the card still points at Street View: ${u}`);
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
  assert.ok(u.includes(`location=${LAT},${LNG}`), 'the image is not for this location');
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
await ita('a failing, blocked or non-JSON metadata call buys nothing', async () => {
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
    assert.equal(spotImageNow(LAT, LNG, KEY), null,
      `${name} still authorised a billed image`);
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
    assert.equal(spotImageNow(LAT, LNG, KEY), null,
      `HTTP ${status} upgraded the card to a billed image`);
  }
});

await ita('no key means no picture and no request', async () => {
  // With the free map gone there is nothing a keyless deployment can draw, so
  // the honest answer is the card's own icon — and above all, no request.
  for (const k of ['', null, undefined]) {
    assert.equal(spotImageNow(LAT, LNG, k), null,
      `no key still produced an image URL`);
    const f = counting('OK');
    assert.equal(await checkPanorama(LAT, LNG, k, f), false,
      'metadata was requested without a key');
    assert.equal(f.calls, 0, 'a keyless deployment still called Google');
  }
});

await ita('a spot with no usable position shows no picture at all', async () => {
  // Number(null) is 0 and 0,0 is the Gulf of Guinea — a card must show its icon
  // rather than the Atlantic. Same Number(null) trap as distanceLabel() and
  // median(); third time in this codebase.
  for (const [a, b] of [[null, null], [undefined, undefined], [0, 0], ['x', 'y'], [NaN, 1], [91, 0], [0, 181]]) {
    assert.equal(hasCoords(a, b), false, `hasCoords(${a},${b}) is true`);
    assert.equal(spotImageNow(a, b, KEY), null, `spotImageNow(${a},${b}) built a URL`);
  }
  // hasCoords is now the guard that stops a request rather than the one that
  // picks a provider, so it is pinned where it still bites: checkPanorama.
  const f = counting('OK');
  await checkPanorama(0, 0, KEY, f);
  await checkPanorama(null, null, KEY, f);
  assert.equal(f.calls, 0, 'Google was asked about a spot with no position');
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
it('the key is URL-encoded and the image is sized for the box it is drawn in', () => {
  assert.ok(metadataUrl(LAT, LNG, 'a b&c=d').includes('key=a%20b%26c%3Dd'),
    'the key is not encoded on the metadata call');
  assert.ok(streetViewUrl(LAT, LNG, 'a b&c=d').includes('key=a%20b%26c%3Dd'),
    'the key is not encoded on the image call');
  // THE SIZE IS PINNED TO A LITERAL, NOT TO IMAGE_SIZE. The first version of
  // this asserted `includes(\`size=${IMAGE_SIZE}\`)`, which is the constant
  // compared against itself — changing IMAGE_SIZE moved both sides and the
  // assertion passed. A mutation to '300x150' survived it.
  //
  // 120x120 IS THE THUMBNAIL AT 2x. The card draws it in a 60x60 box, so this
  // is the retina-sharp size; the previous 600x300 was twenty-five times the
  // area of the box, which on a list of hundreds of cards is mobile data spent
  // on pixels nobody sees. Street View Static bills per request and not per
  // pixel, so this is bandwidth rather than money.
  assert.equal(IMAGE_SIZE, '120x120', 'the card image size changed — check the 60x60 box still fits');
  assert.ok(streetViewUrl(LAT, LNG, KEY).includes('size=120x120'), 'the Street View size changed');
  assert.ok(streetViewUrl(LAT, LNG, KEY, '300x300').includes('size=300x300'),
    'a caller can no longer ask for its own size');
  assert.match(app, /w-\[60px\] h-\[60px\]/,
    'the card thumbnail is no longer 60x60 — IMAGE_SIZE should follow it');
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
  assert.ok(!/GOOGLE_MAPS_KEY \? spotImageUrl/.test(appCode),
    'the old GOOGLE_MAPS_KEY gate is back');
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

it('the retired host is out of the CSP and Street View is still in', () => {
  // A dead origin left in img-src is not dangerous, it is a lie about what the
  // page loads. Both copies have to agree: the meta tag serves GitHub Pages,
  // the header serves Vercel.
  for (const f of ['../../vercel.json', '../../index.html']) {
    const src = read(f);
    assert.ok(!/staticmap\.openstreetmap\.de/.test(src),
      `${f} still allows the discontinued static map host`);
    assert.match(src, /img-src[^;]*https:\/\/maps\.googleapis\.com/,
      `${f} dropped maps.googleapis.com from img-src — Street View cannot draw`);
  }
});

// ── 4. A refused key is refused once, not 790 times ──────────────────────────
await ita('REQUEST_DENIED stops the asking for the whole session', async () => {
  // DEFECT 3. This is the one that costs real requests: the Street View Static
  // API not being enabled is the CURRENT state of this project, so without
  // this every spot in the list asks and is refused.
  const f = counting('REQUEST_DENIED');
  assert.equal(keyRefused(), false, 'the breaker was already tripped before anything was asked');
  assert.equal(await checkPanorama(LAT, LNG, KEY, f), false);
  assert.equal(keyRefused(), true, 'a REQUEST_DENIED did not trip the breaker');
  // Every OTHER spot must now resolve false without a request.
  for (const [a, b] of [[54.6, -5.93], [54.61, -5.94], [54.62, -5.95], [55.0, -7.3]]) {
    assert.equal(await checkPanorama(a, b, KEY, f), false, 'a refused key kept answering true');
  }
  assert.equal(f.calls, 1, `a refused key was re-asked ${f.calls} times`);
});

await ita('OVER_QUERY_LIMIT trips it too, and ZERO_RESULTS never does', async () => {
  // The cap does not lift mid-session, so it is key-level. ZERO_RESULTS is the
  // opposite: it is the answer for THIS layby and says nothing about the next.
  assert.deepEqual([...KEY_REFUSALS].sort(), ['OVER_QUERY_LIMIT', 'REQUEST_DENIED']);
  for (const s of ['REQUEST_DENIED', 'OVER_QUERY_LIMIT']) {
    assert.equal(isKeyRefusal({ status: s }), true, `${s} is not treated as key-level`);
  }
  for (const s of ['ZERO_RESULTS', 'OK', 'INVALID_REQUEST', 'UNKNOWN_ERROR', '']) {
    assert.equal(isKeyRefusal({ status: s }), false, `${s} was treated as key-level`);
  }
  assert.equal(isKeyRefusal(null), false);

  resetPanoramaCache();
  const f = counting('ZERO_RESULTS');
  for (const [a, b] of [[54.6, -5.93], [54.61, -5.94], [54.62, -5.95]]) {
    await checkPanorama(a, b, KEY, f);
  }
  assert.equal(keyRefused(), false, 'ZERO_RESULTS tripped the breaker — every other spot goes unasked');
  assert.equal(f.calls, 3, 'a per-location "no" stopped the other locations being asked');
});

await ita('an HTTP 403 or 429 trips it before a body is ever parsed', async () => {
  // A referrer restriction that excludes this domain is a 403 at the HTTP
  // level with no Google status in the body at all, so the body check alone
  // would never see it and every spot would be asked.
  assert.deepEqual([...KEY_REFUSAL_HTTP].sort((x, y) => x - y), [403, 429]);
  for (const status of [403, 429]) {
    resetPanoramaCache();
    const f = async () => ({ ok: false, status, json: async () => { throw new Error('html'); } });
    assert.equal(await checkPanorama(LAT, LNG, KEY, f), false);
    assert.equal(keyRefused(), true, `HTTP ${status} did not trip the breaker`);
  }
  // A transient server error must NOT trip it — that would silently disable
  // pictures for the rest of the session over one bad response.
  for (const status of [500, 502, 503]) {
    resetPanoramaCache();
    const f = async () => ({ ok: false, status, json: async () => ({}) });
    await checkPanorama(LAT, LNG, KEY, f);
    assert.equal(keyRefused(), false, `HTTP ${status} tripped the breaker`);
  }
});

await ita('a confirmed panorama still builds no URL without a key', async () => {
  // A HOLE A MUTATION FOUND, and the reason the `!key` guard in spotImageNow()
  // is load-bearing rather than belt-and-braces. `answers` is keyed by
  // LOCATION, not by location-plus-key, so once a panorama is confirmed the
  // cache says "yes" to any caller at all. Remove that guard and a keyless
  // call then builds ...&key= — a request that cannot succeed, aimed at the
  // billed endpoint.
  //
  // Every other test here either passes a key or has no confirmed panorama, so
  // the guard was unreachable from the suite and a mutation deleting it
  // survived. This is the one order that reaches it.
  assert.equal(await checkPanorama(LAT, LNG, KEY, counting('OK')), true);
  assert.equal(knownPanorama(LAT, LNG), true, 'the panorama was not confirmed — the test proves nothing');
  for (const k of ['', null, undefined]) {
    assert.equal(spotImageNow(LAT, LNG, k), null,
      `a confirmed panorama built an image URL with key=${JSON.stringify(k)}`);
  }
  assert.ok(spotImageNow(LAT, LNG, KEY), 'the keyed call lost its picture too — the guard is too wide');
});

await ita('a panorama already confirmed survives a later refusal', async () => {
  // Ordering matters: `answers` is read before the breaker, so a spot that was
  // confirmed keeps its picture when the quota runs out afterwards. The other
  // order would blank a picture that is already on screen.
  assert.equal(await checkPanorama(LAT, LNG, KEY, counting('OK')), true);
  assert.equal(await checkPanorama(54.7, -6.0, KEY, counting('REQUEST_DENIED')), false);
  assert.equal(keyRefused(), true);
  assert.equal(await checkPanorama(LAT, LNG, KEY, counting('REQUEST_DENIED')), true,
    'a confirmed panorama was dropped when the key was later refused');
  assert.ok(spotImageNow(LAT, LNG, KEY), 'the confirmed card lost its picture');
});

console.log(`\n  ${passed} checks passed\n`);
