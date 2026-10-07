// The map was covered in another company's watermark and every test was green.
//
// CARTO moved its raster basemaps behind an API key. It did not start returning
// 401 — it kept serving the tiles with "API KEY REQUIRED / carto.com/basemaps/
// apikey" printed diagonally across each one. The map drew, Belfast was in the
// right place, no request failed, no console error appeared. The only way it
// was ever going to be found was somebody photographing their own screen, which
// is what happened.
//
// These checks are the ones that would have caught it, plus the one that would
// have caught the fix shipping broken: the replacement tile host was NOT
// permitted by the site's own Content-Security-Policy. img-src already listed
// https://*.tile.openstreetmap.org, and a wildcard subdomain does not match the
// bare host https://tile.openstreetmap.org, so every tile would have been
// blocked and the map would have gone from watermarked to blank.
//
// GOOGLE IS NOW THE PREFERRED PROVIDER, AND IT ADDED TWO NEW WAYS TO SHIP A
// BROKEN MAP, both covered below. The official Map Tiles API needs a session
// token fetched over the network before it will serve a single tile, so (1) a
// Google key with no token yet must fall through to CARTO or OSM rather than
// requesting tiles with `session=undefined` on them, and (2) the two-line
// unofficial endpoints that need no token — mt0/mt1 with an lyrs parameter —
// must never appear in the source, because using them is a Terms of Service
// breach that gets the key and the billing account suspended, taking Places and
// the rest of the app down with the map.
//
// A note on the habit of stripping comments before matching (learned the hard
// way in hotspotFunnel.test.mjs, four times over): a check that greps source
// for a forbidden string will fire on the comment explaining why the string is
// forbidden. Everything below that scans App.jsx strips comments first — and so
// does the check on mapTiles.js itself, whose header names the very endpoints it
// is forbidding.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildTileUrl, buildAttribution, buildTileLayerProps, buildTileClass,
  buildProvider, buildSessionRequest, buildSessionFingerprint,
  buildSessionRecord, buildStoredSession, SESSION_SKEW_MS,
  tileUrl, tileAttribution, tileLayerProps, tileThemeClass, usingCarto,
  usingGoogle, tileProvider, googleTiles,
  OSM_TILE_HOST, GOOGLE_TILE_HOST, GOOGLE_SESSION_ENDPOINT, onTilesChanged,
} from '../../src/mapTiles.js';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const app = read('../../src/App.jsx');
const indexHtml = read('../../index.html');
const vercel = JSON.parse(read('../../vercel.json'));
const css = read('../../src/index.css');

// Strip // line comments and {/* */} JSX blocks. See the note above. The
// block-comment pattern is anchored to the start of a line on purpose: an
// unanchored /* ... */ matches the `image/*` inside accept="image/*" and then
// swallows 16,000 characters of real code, including one of the maps this file
// is meant to be counting.
const stripComments = src => src
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
  .replace(/^\s*\/\*[\s\S]*?\*\//gm, '')
  .replace(/^\s*\/\/.*$/gm, '');
const appCode = stripComments(app);

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };

// A Google key plus a live session — what the builders see once createSession
// has come back. `key` alone is deliberately NOT enough; see the precedence
// checks below.
const G = { key: 'gkey', session: 'sess-123' };

console.log('\nmapTiles — no watermark, no blank map');

it('a keyless build never requests a CARTO tile', () => {
  const url = buildTileUrl('');
  assert.ok(!/cartocdn/.test(url), `keyless build still asks CARTO for tiles: ${url}`);
  assert.ok(!/cartocdn/.test(buildTileUrl('', true)), 'light mode still asks CARTO');
  // This is the exact request that came back watermarked.
  assert.notEqual(url, 'https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png');
});

it('a CARTO tile is only ever requested with a key attached', () => {
  for (const light of [false, true]) {
    const url = buildTileUrl('abc123', light);
    assert.match(url, /cartocdn/, 'a key was set but CARTO is not being used');
    assert.match(url, /[?&]api_key=abc123(&|$)/, `no api_key on ${url}`);
  }
  // Different styles for the two themes, or light mode gets a dark map.
  assert.notEqual(buildTileUrl('k', false), buildTileUrl('k', true));
  assert.match(buildTileUrl('k', false), /dark_all/);
  assert.match(buildTileUrl('k', true), /voyager/);
});

it('a key with url-unsafe characters is encoded, not pasted', () => {
  const url = buildTileUrl('a b&z=1');
  assert.ok(!/api_key=a b/.test(url), `raw space in ${url}`);
  assert.match(url, /api_key=a%20b%26z%3D1/, `key not encoded: ${url}`);
});

//------------------------------------------------------------------- Google
// The preferred provider, and the one that can only be reached through a
// session token.

it('provider precedence is Google, then CARTO, then OSM', () => {
  assert.equal(buildProvider('', null), 'osm', 'no keys at all must still give a map');
  assert.equal(buildProvider('ck', null), 'carto');
  assert.equal(buildProvider('', G), 'google');
  assert.equal(buildProvider('ck', G), 'google',
    'a CARTO key is winning over Google — Google is the preferred provider');
});

it('a Google key with no session yet falls through instead of breaking the map', () => {
  // THE FAILURE THIS EXISTS FOR. createSession is a network call: it is slow, it
  // 403s without billing, it never answers offline. Treating "key present" as
  // "Google available" renders session=undefined on every tile URL, which is a
  // 400 per tile and a blank map — the one outcome this module must never have.
  for (const half of [{ key: 'gkey', session: '' }, { key: '', session: 'sess-123' }, {}, null]) {
    assert.equal(buildProvider('', half), 'osm', `half a Google config was accepted: ${JSON.stringify(half)}`);
    assert.equal(buildProvider('ck', half), 'carto',
      `half a Google config beat a working CARTO key: ${JSON.stringify(half)}`);
    const url = buildTileUrl('', false, half);
    assert.ok(!/tile\.googleapis\.com/.test(url), `a Google tile requested with no session: ${url}`);
    assert.ok(!/undefined/.test(url), `"undefined" in a tile url: ${url}`);
  }
});

it('a Google tile is the official 2dtiles endpoint, with session and key', () => {
  const url = buildTileUrl('ck', false, G);
  assert.match(url, /^https:\/\/tile\.googleapis\.com\/v1\/2dtiles\/\{z\}\/\{x\}\/\{y\}\?/,
    `not the official Map Tiles API endpoint: ${url}`);
  assert.match(url, /[?&]session=sess-123(&|$)/, `no session on ${url}`);
  assert.match(url, /[?&]key=gkey(&|$)/, `no key on ${url}`);
  // Leaflet fills these three; a missing one means every tile is the same tile.
  for (const ph of ['{z}', '{x}', '{y}']) {
    assert.ok(url.includes(ph), `${ph} missing from ${url}`);
  }
  assert.ok(!url.includes('{s}'), 'a Google url with an {s} and no subdomains to fill it');
  assert.ok(!url.includes('{r}'), 'a {r} Google will not honour');
  // The theme cannot change the url: there is one roadmap session, and asking
  // for a light variant that does not exist would silently serve nothing.
  assert.equal(buildTileUrl('ck', true, G), url);
});

it('a session or key with url-unsafe characters is encoded, not pasted', () => {
  const url = buildTileUrl('', false, { key: 'a b&z=1', session: 's/s?s' });
  assert.ok(!/session=s\/s\?s/.test(url), `raw session in ${url}`);
  assert.match(url, /session=s%2Fs%3Fs/, `session not encoded: ${url}`);
  assert.match(url, /key=a%20b%26z%3D1/, `key not encoded: ${url}`);
});

// THE ONE THAT SUSPENDS THE BILLING ACCOUNT. mt0/mt1.google.com/vt?lyrs=m needs
// no session and is four lines shorter, which is exactly why somebody will
// reach for it. It is not licensed for this.
it('no unofficial Google tile endpoint anywhere in the module', () => {
  const src = stripComments(read('../../src/mapTiles.js'));
  for (const forbidden of [/mt[0-9]\.google/, /\blyrs=/, /khms?[0-9]?\.google/, /maps\.google\.com\/vt/]) {
    assert.ok(!forbidden.test(src),
      `an unofficial Google tile endpoint is in the source (${forbidden}) — this is a Maps Platform ToS breach and gets the key suspended`);
  }
  // And the licensed one is genuinely what is used.
  assert.match(src, /https:\/\/tile\.googleapis\.com/, 'the official tile host is gone');
  assert.match(src, /\/v1\/createSession/, 'nothing creates a session — the official API will not serve tiles');
});

it('the createSession request is the documented POST, not a GET', () => {
  const req = buildSessionRequest('gk');
  assert.equal(req.method, 'POST', 'createSession only answers POST');
  assert.equal(req.url, `${GOOGLE_SESSION_ENDPOINT}?key=gk`);
  assert.match(req.url, /^https:\/\/tile\.googleapis\.com\/v1\/createSession\?key=/);
  assert.equal(req.headers['Content-Type'], 'application/json',
    'without the json content type the body is ignored and the call 400s');
  const body = JSON.parse(req.body);
  // mapType, language and region are the required fields.
  assert.equal(body.mapType, 'roadmap');
  assert.ok(body.language, 'language is required');
  assert.ok(body.region, 'region is required');
  assert.equal(buildSessionRequest('a b').url, `${GOOGLE_SESSION_ENDPOINT}?key=a%20b`);

  // High-DPI is asked for at the session end, not by Leaflet's detectRetina.
  const hi = JSON.parse(buildSessionRequest('gk', true).body);
  assert.equal(hi.highDpi, true);
  assert.equal(hi.scale, 'scaleFactor2x', 'highDpi without a scale factor is ignored');
  assert.equal(body.highDpi, undefined, 'a 1x session is asking for 2x tiles');
});

it('a cached session cannot be reused for a different configuration', () => {
  // A token is bound to the map configuration and the project it was minted
  // for, so the fingerprint has to move when either does.
  assert.notEqual(buildSessionFingerprint('gk', false), buildSessionFingerprint('gk', true),
    'a 1x and a 2x session share a fingerprint — one will be reused for the other');
  assert.notEqual(buildSessionFingerprint('gk'), buildSessionFingerprint('other-key'),
    'two Google projects share a fingerprint — a token from the wrong project will be reused');
  assert.equal(buildSessionFingerprint('gk'), buildSessionFingerprint('gk'), 'not stable');
  // Derived from the request itself, so it cannot drift from what was sent.
  assert.ok(buildSessionFingerprint('gk').includes(buildSessionRequest('gk').body),
    'the fingerprint does not describe the request it guards');
});

it('a createSession response is only trusted when it really carries a session', () => {
  // expiry comes back as seconds since the epoch, quoted as a string.
  const ok = buildSessionRecord({ session: 's1', expiry: '1800000000', tileWidth: 256 }, 'fp');
  assert.deepEqual(ok, { session: 's1', expirySec: 1800000000, fingerprint: 'fp' });
  assert.equal(typeof ok.expirySec, 'number',
    'expiry kept as a string — multiplying it by 1000 later gives NaN and the token is thrown away every load');

  for (const bad of [
    null, undefined, {}, 'nope',
    { expiry: '1800000000' },                       // an error body with no session
    { session: '', expiry: '1800000000' },
    { session: 's1' },                              // no expiry: cannot be cached safely
    { session: 's1', expiry: 'soon' },
    { session: 's1', expiry: '0' },
    { session: { id: 's1' }, expiry: '1800000000' },
  ]) {
    assert.equal(buildSessionRecord(bad, 'fp'), null,
      `a response with no usable session was accepted: ${JSON.stringify(bad)}`);
  }
});

it('a stored session is only reused while it is genuinely still valid', () => {
  const now = 1_800_000_000_000;
  const fp = 'fp';
  const rec = (over = {}) => JSON.stringify({ session: 's1', expirySec: now / 1000 + 86400, fingerprint: fp, ...over });

  assert.equal(buildStoredSession(rec(), fp, now), 's1');
  assert.equal(buildStoredSession(JSON.parse(rec()), fp, now), 's1', 'a parsed record must work too');

  // An expired token is not an error at tile time — it is 403 on every tile and
  // a blank map. It has to be treated as no token at all.
  assert.equal(buildStoredSession(rec({ expirySec: now / 1000 - 1 }), fp, now), '',
    'an expired session token was reused — every tile 403s and the map draws blank');
  assert.equal(buildStoredSession(rec({ expirySec: now / 1000 + 10 }), fp, now), '',
    `a token expiring within ${SESSION_SKEW_MS}ms was reused — it dies mid-pan`);
  assert.equal(buildStoredSession(rec({ expirySec: now / 1000 + SESSION_SKEW_MS / 1000 + 60 }), fp, now), 's1',
    'the skew is throwing away tokens that are still good');

  assert.equal(buildStoredSession(rec(), 'other-fp', now), '',
    'a session minted for another configuration was reused');
  for (const junk of [null, undefined, '', 'not json', '{', '[]', JSON.stringify({ session: 's1' }),
                      JSON.stringify({ session: '', expirySec: now / 1000 + 9e9, fingerprint: fp }),
                      JSON.stringify({ session: 's1', expirySec: 'later', fingerprint: fp })]) {
    assert.equal(buildStoredSession(junk, fp, now), '',
      `unusable stored value accepted: ${String(junk)}`);
  }

  // A session that is not a string has to be rejected by TYPE, not by being
  // falsy — returning it puts "[object Object]" in the session parameter of
  // every tile url, which is a 400 per tile and a blank map. (The empty-string
  // case above cannot be tested apart from this: '' is also the rejection
  // value, so dropping that half of the guard changes no behaviour at all.)
  assert.strictEqual(buildStoredSession({ session: { id: 's1' }, expirySec: now / 1000 + 86400, fingerprint: fp }, fp, now), '',
    'a non-string session was handed back — every tile url gets session=[object Object]');
  assert.strictEqual(buildStoredSession({ session: 12345, expirySec: now / 1000 + 86400, fingerprint: fp }, fp, now), '',
    'a numeric session was handed back as a token');
});

it('attribution credits the provider actually serving the tiles', () => {
  const keyless = buildAttribution('');
  assert.match(keyless, /OpenStreetMap/);
  assert.match(keyless, /contributors/, 'the OSM licence asks for "contributors"');
  assert.ok(!/CARTO/i.test(keyless),
    'crediting CARTO while serving OpenStreetMap tiles — wrong, and a licence breach');

  const withKey = buildAttribution('k');
  assert.match(withKey, /CARTO/);
  assert.match(withKey, /OpenStreetMap/, 'CARTO tiles are OSM data and still need the OSM credit');

  // Google's imagery is not OSM data, so this is the same licence breach in the
  // other direction: crediting OpenStreetMap for Google's tiles, and not
  // crediting Google, which the Map Tiles API requires.
  const google = buildAttribution('k', G);
  assert.match(google, /Google/, 'Google tiles with no Google attribution — the API requires it');
  assert.ok(!/OpenStreetMap/i.test(google), 'crediting OpenStreetMap for Google imagery');
  assert.ok(!/CARTO/i.test(google), 'crediting CARTO while serving Google tiles');
});

// THE ONE THAT DID SHIP BROKEN, for about ten minutes, and blanked the app.
// `subdomains: undefined` is not the same as no subdomains key: Leaflet copies
// it over its own 'abc' default and the first tile throws in _getSubdomain,
// during render, which unmounts everything. Own-property presence is the
// assertion, not the value — `props.subdomains === undefined` is true either
// way and would have passed on the broken version.
it('the keyless props carry no subdomains key at all, not an undefined one', () => {
  const props = buildTileLayerProps('');
  assert.ok(!('subdomains' in props),
    'subdomains is present on the keyless props — Leaflet will crash in _getSubdomain and white-screen the app');
  assert.ok(!buildTileUrl('').includes('{s}'), 'keyless url has an {s} with nothing to fill it');

  const withKey = buildTileLayerProps('k');
  assert.equal(withKey.subdomains, 'abcd');
  assert.ok(buildTileUrl('k').includes('{s}'), 'CARTO url lost its {s} but subdomains are still set');

  // Same crash, same reason, on the provider that now ships by default: the
  // Google url has no {s} either, so it must not carry a subdomains key.
  const google = buildTileLayerProps('k', false, G);
  assert.ok(!('subdomains' in google),
    'subdomains is present on the Google props — Leaflet will crash in _getSubdomain and white-screen the app');
});

it('the props object is the whole of what a tile layer needs', () => {
  for (const key of ['', 'k']) {
    const props = buildTileLayerProps(key);
    assert.equal(props.url, buildTileUrl(key));
    assert.equal(props.attribution, buildAttribution(key));
    assert.equal(props.detectRetina, true, 'retina tiles turned off');
  }
  const google = buildTileLayerProps('k', false, G);
  assert.equal(google.url, buildTileUrl('k', false, G));
  assert.equal(google.attribution, buildAttribution('k', G));
  // detectRetina OFF for Google, and this is a billing check, not a looks one:
  // Leaflet implements it by halving tileSize and adding one to the zoom, so it
  // asks for FOUR metered tiles where it asked for one — and only swaps in an
  // @2x image if the url has an {r}, which Google's has not. The 2x tiles come
  // from the session (highDpi) instead.
  assert.equal(google.detectRetina, false,
    'detectRetina is on for Google — that is 4x the tile requests, and 4x the bill, for no extra sharpness');
});

it('the invert class marks the provider and is never on a dark CARTO map', () => {
  assert.equal(buildTileClass(''), 'map-osm-tiles');
  assert.equal(buildTileClass('k'), '',
    'inverting CARTO dark_all would produce a white map');
  // It must NOT depend on the theme: the class is computed in render, so a
  // theme-dependent class survives a toggle that does not re-render the map,
  // and the light-mode user is left looking at an inverted one. Passing a
  // truthy second argument must change nothing.
  // (Function.length does not catch this — a default parameter is not counted,
  // so (key, light = false) still reports length 1. Behaviour is the only test.)
  assert.equal(buildTileClass('', true), 'map-osm-tiles',
    'the class depends on the theme again — toggling the theme will leave a stale one on the map');

  // Google roadmap must not be inverted either. The filter is invert(1)
  // hue-rotate(180deg), tuned for OSM's palette; over Google's roadmap it gives
  // a photo negative, not a dark map.
  assert.equal(buildTileClass('', false, G), '', 'the invert filter is being applied to Google roadmap tiles');
  assert.equal(buildTileClass('k', true, G), '', 'the invert filter is being applied to Google roadmap tiles');

  const src = read('../../src/mapTiles.js');
  assert.match(src, /tileThemeClass = \(\) => buildTileClass\(cartoKey\(\), isLight\(\), googleTiles\(\)\)/,
    'tileThemeClass reads something other than the keys');
});

it('css decides the theme, and only the tile pane is filtered', () => {
  assert.match(css, /\.map-osm-tiles \.leaflet-tile-pane\s*\{[^}]*invert\(1\)/,
    '.map-osm-tiles no longer filters the tile pane');
  assert.match(css, /\[data-theme="light"\] \.map-osm-tiles \.leaflet-tile-pane\s*\{[^}]*filter:\s*none/,
    'light mode has no override — a light-mode user gets an inverted map');
  // A filter on the container would invert markers, popups and controls too.
  assert.ok(!/\.map-osm-tiles\s*\{[^}]*filter/.test(css),
    'the filter is on the whole map container — pins and popups will be inverted');
});

// THE ONE THAT NEARLY SHIPPED. A tile host missing from img-src is a blank map.
it('every tile host the app can request is permitted by both CSPs', () => {
  // {s} is filled by Leaflet from `subdomains`, so the host that is actually
  // requested has a subdomain on it — that is what the CSP has to allow.
  const hosts = [buildTileUrl(''), buildTileUrl('k'), buildTileUrl('k', false, G)]
    .map(u => u.replace('{s}', buildTileLayerProps('k').subdomains[0]).match(/^https:\/\/[^/]+/)[0]);
  assert.ok(hosts.includes(OSM_TILE_HOST), 'the OSM host is no longer a tile host');
  assert.ok(hosts.includes(GOOGLE_TILE_HOST), 'the Google host is no longer a tile host');

  // The POLICY, not the prose. index.html carries a comment above the meta tag
  // that says "connect-src MUST include places.googleapis.com", and a directive
  // regex run over the whole file matches that sentence instead of the policy —
  // which is a check that reads the comment explaining the rule and calls it the
  // rule. Pull the content attribute out first.
  const metaCsp = indexHtml.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/);
  assert.ok(metaCsp, 'index.html no longer carries a Content-Security-Policy meta tag');
  const indexCsp = metaCsp[1];

  const directive = (name, csp) => {
    const found = csp.match(new RegExp(`(?:^|;)\\s*${name} ([^;]+)`));
    assert.ok(found, `no ${name} in this Content-Security-Policy`);
    return found[1].trim().split(/\s+/);
  };
  const imgSrc = csp => directive('img-src', csp);
  const allows = (list, host) => list.some(entry => {
    if (entry === host) return true;
    if (!entry.startsWith('https://*.')) return false;
    // *.example.com covers sub.example.com but NOT example.com itself.
    return host.endsWith(entry.slice('https://*'.length));
  });

  const vercelCsp = vercel.headers
    ?.flatMap(h => h.headers || [])
    .find(h => h.key === 'Content-Security-Policy')?.value;
  assert.ok(vercelCsp, 'vercel.json no longer sends a Content-Security-Policy');

  for (const [where, list] of [['index.html', imgSrc(indexCsp)], ['vercel.json', imgSrc(vercelCsp)]]) {
    for (const host of hosts) {
      assert.ok(allows(list, host),
        `${where} img-src blocks ${host} — every tile 403s and the map draws blank`);
    }
  }

  // createSession is a fetch, not an image, so img-src does nothing for it. A
  // connect-src that blocks it fails the session silently, and the app quietly
  // serves OSM for ever while the owner is billed for nothing.
  const sessionHost = GOOGLE_SESSION_ENDPOINT.match(/^https:\/\/[^/]+/)[0];
  for (const [where, csp] of [['index.html', indexCsp], ['vercel.json', vercelCsp]]) {
    assert.ok(allows(directive('connect-src', csp), sessionHost),
      `${where} connect-src blocks ${sessionHost} — no session token, so Google tiles never load`);
  }
});

it('App.jsx holds no tile url of its own', () => {
  assert.ok(!/cartocdn|openstreetmap\.org\/\{z\}/.test(appCode),
    'a tile url is hardcoded in App.jsx again — it will not follow the key');
  assert.match(appCode, /from '\.\/mapTiles'/, 'App.jsx no longer imports the tile module');
});

it('every map spreads the derived props and carries the theme class', () => {
  // THE TILE LAYER MOVED. It used to be written out at each of App.jsx's five
  // maps; it now lives once in BaseTileLayer, which subscribes so the map can
  // switch to Google when the session token lands (see the checks at the end of
  // this file). The rule is unchanged and is now checked in both places: App
  // must render only the subscribing component, and that component must spread
  // the derived props with nothing beside them.
  // Comments stripped first: this file's own header quotes the old
  // `<TileLayer {...tileLayerProps()}/>` to explain what changed, and matching
  // that counted as a second tile layer.
  const strip = (src) => src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  const baseCode = strip(read('../../src/components/map/BaseTileLayer.jsx'));
  const layers = baseCode.match(/<TileLayer[^>]*\/>/g) || [];
  assert.equal(layers.length, 1, `BaseTileLayer should hold exactly one tile layer, found ${layers.length}`);
  for (const l of layers) {
    assert.match(l, /\{\.\.\.tileLayerProps\(\)\}/, `tile layer not using the derived props: ${l}`);
    // A prop written out beside the spread overrides it — which is how a
    // hardcoded url or a stale attribution gets back in.
    assert.ok(!/\b(url|attribution|subdomains)=/.test(l), `prop overriding the spread: ${l}`);
  }
  // And App.jsx must not have grown a bare one back: a <TileLayer> rendered
  // there does not subscribe, so it keeps whatever provider it mounted with.
  assert.deepEqual(strip(appCode).match(/<TileLayer[^>]*\/>/g) || [], [],
    'App.jsx renders a TileLayer directly again — that one will not switch to Google after mount');

  const maps = appCode.match(/<MapContainer[\s>][^>]*/g) || [];
  const mounts = appCode.match(/<BaseTileLayer\s*\/>/g) || [];
  assert.ok(mounts.length >= 5, `expected the app's map layers, found ${mounts.length}`);
  assert.equal(maps.length, mounts.length,
    `${maps.length} maps but ${mounts.length} tile layers`);
  for (const m of maps) {
    assert.match(m, /className=\{tileThemeClass\(\)\}/,
      `a map that will show light tiles in dark mode: ${m.slice(0, 80)}`);
  }
});

it('the env-reading wrappers agree with the builders they wrap', () => {
  // Neither key is set under Node, so this is the keyless branch — and with no
  // key there must have been no network call at import time either.
  assert.equal(usingCarto(), false);
  assert.equal(usingGoogle(), false);
  assert.equal(tileProvider(), 'osm');
  assert.equal(googleTiles(), null, 'a Google config out of thin air, with no key set');
  assert.equal(tileUrl(), buildTileUrl(''));
  assert.equal(tileAttribution(), buildAttribution(''));
  assert.equal(tileThemeClass(), buildTileClass(''));
  assert.deepEqual(Object.keys(tileLayerProps()).sort(), Object.keys(buildTileLayerProps('')).sort());
  // And they must not throw where there is no document, localStorage, fetch or
  // devicePixelRatio either (SSR/prerender, and this test run).
  assert.equal(typeof globalThis.document, 'undefined');
  assert.equal(typeof globalThis.localStorage, 'undefined');
});

console.log(`\n  ${passed} checks passed\n`);

// ── The reason the map stayed on OpenStreetMap ────────────────────────────────
//
// The session token arrives asynchronously and lands in a module variable.
// tileLayerProps() reads it at render time, so React never learned it had
// changed: the map kept the OSM url it mounted with, and only a SECOND page
// load came up on Google, when the cached token could be read synchronously.
// A first-time visitor therefore saw OpenStreetMap for their entire visit.
//
// react-leaflet 4.2.1's TileLayer does call layer.setUrl() when the url prop
// changes — verified in node_modules/react-leaflet/lib/TileLayer.js — so the
// only missing piece was ever a re-render. These checks hold the subscription
// that provides it, and the one component that owns it.
it('the module can tell React that the provider changed', () => {
  assert.equal(typeof onTilesChanged, 'function', 'there is no way to learn the session arrived');
  let hits = 0;
  const off = onTilesChanged(() => { hits++; });
  assert.equal(typeof off, 'function', 'the subscription cannot be cancelled, so a map leaks a listener');
  off();
  // Unsubscribing twice is not an error.
  off();
  assert.equal(hits, 0, 'nothing has fired yet, so the fixture is wrong');
  // Junk still yields a callable unsubscribe, so callers never have to guard.
  // NOTE this is weaker than it looks: without the typeof guard the returned
  // closure is a function anyway, so the behaviour above cannot detect a
  // missing guard. The guard itself is asserted in source below, and labelled
  // as such rather than dressed up as a behavioural check.
  for (const junk of [null, undefined, 42, 'nope', {}]) {
    assert.equal(typeof onTilesChanged(junk), 'function', `onTilesChanged(${String(junk)}) returned no unsubscribe`);
  }
  assert.match(read('../../src/mapTiles.js'), /if \(typeof fn !== 'function'\) return \(\) => \{\};/,
    'the listener guard is gone — junk now enters the Set and relies on the try/catch in notify');
});

it('one bad listener cannot strand every other map on the fallback', () => {
  const src = read('../../src/mapTiles.js');
  const at = src.indexOf('const notifyTilesChanged');
  assert.ok(at > 0, 'notifyTilesChanged is gone');
  const body = src.slice(at, src.indexOf('\n};', at));
  assert.match(body, /try \{ fn\(\); \} catch/,
    'a throwing listener aborts the loop, so maps after it never hear the session arrived');
  assert.match(body, /\[\.\.\.listeners\]/,
    'the live Set is iterated, so a listener unsubscribing during notify can skip another');
});

it('the session arriving notifies, on both the cached and the fetched path', () => {
  const src = read('../../src/mapTiles.js');
  const fn = src.slice(src.indexOf('export const ensureGoogleSession'));
  const body = fn.slice(0, fn.indexOf('\n};'));
  assert.match(body, /if \(cached\) \{ session = cached; notifyTilesChanged\(\); return session; \}/,
    'the cached path does not notify');
  // The fetched path is the one that matters: it is the only path where a map
  // is already mounted on the wrong provider.
  const afterStore = body.slice(body.indexOf('writeStore(SESSION_STORE_KEY'));
  assert.match(afterStore, /notifyTilesChanged\(\)/,
    'the fetched session never notifies, so a mounted map stays on OpenStreetMap');
});

it('a fallback says WHY, because every failure looks the same from outside', () => {
  const src = read('../../src/mapTiles.js');
  // SCOPED TO THE MESSAGE, not the file. This module's header comment explains
  // the same three causes, so matching the whole file passed even with the
  // message gutted — a mutation proved exactly that.
  const at = src.indexOf('[ParkEasy] Google Map Tiles unavailable');
  assert.ok(at > 0, 'a failed session is silent, so a 403 is indistinguishable from no key at all');
  const warn = src.slice(at, src.indexOf(');', at));
  assert.match(warn, /HTTP \$\{res \? res\.status : 'no response'\}/,
    'the message does not carry the status code, which is the one fact that identifies the cause');
  assert.match(warn, /Google said: \$\{String\(detail\)/,
    'Google\'s own error body is not shown, so the specific reason is thrown away');
  // The three real causes, named in the MESSAGE so nobody has to guess again.
  assert.match(warn, /Map Tiles API not enabled/, 'the message does not name the commonest cause');
  assert.match(warn, /billing/i, 'the message does not mention billing');
  assert.match(warn, /referrer/i, 'the message does not mention a referrer restriction');
});

it('every map renders the subscribing component, not a bare TileLayer', () => {
  const base = read('../../src/components/map/BaseTileLayer.jsx');
  assert.doesNotMatch(app, /<TileLayer \{\.\.\.tileLayerProps\(\)\}\/>/,
    'a map renders tileLayerProps() directly again — that one will not switch to Google after mount');
  assert.ok(app.split('<BaseTileLayer/>').length - 1 >= 5,
    'not every map was switched over; the ones left behind keep their mount-time provider');
  assert.match(base, /onTilesChanged\(\(\) => bump/, 'BaseTileLayer does not subscribe');
  // Props read fresh each render, NOT cached in state: tileLayerProps() also
  // depends on the theme, which changes with no notification at all.
  assert.match(base, /return <TileLayer \{\.\.\.tileLayerProps\(\)\}\/>/,
    'the props are cached in state, so a theme change leaves the old tiles');
});
