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
// A note on the habit of stripping comments before matching (learned the hard
// way in hotspotFunnel.test.mjs, four times over): a check that greps source
// for a forbidden string will fire on the comment explaining why the string is
// forbidden. Everything below that scans App.jsx strips comments first.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildTileUrl, buildAttribution, buildTileLayerProps, buildTileClass,
  tileUrl, tileAttribution, tileLayerProps, tileThemeClass, usingCarto,
  OSM_TILE_HOST,
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

it('attribution credits the provider actually serving the tiles', () => {
  const keyless = buildAttribution('');
  assert.match(keyless, /OpenStreetMap/);
  assert.match(keyless, /contributors/, 'the OSM licence asks for "contributors"');
  assert.ok(!/CARTO/i.test(keyless),
    'crediting CARTO while serving OpenStreetMap tiles — wrong, and a licence breach');

  const withKey = buildAttribution('k');
  assert.match(withKey, /CARTO/);
  assert.match(withKey, /OpenStreetMap/, 'CARTO tiles are OSM data and still need the OSM credit');
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
});

it('the props object is the whole of what a tile layer needs', () => {
  for (const key of ['', 'k']) {
    const props = buildTileLayerProps(key);
    assert.equal(props.url, buildTileUrl(key));
    assert.equal(props.attribution, buildAttribution(key));
    assert.equal(props.detectRetina, true, 'retina tiles turned off');
  }
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
  const src = read('../../src/mapTiles.js');
  assert.match(src, /tileThemeClass = \(\) => buildTileClass\(cartoKey\(\)\)/,
    'tileThemeClass reads something other than the key');
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
  const hosts = [buildTileUrl(''), buildTileUrl('k')]
    .map(u => u.replace('{s}', buildTileLayerProps('k').subdomains[0]).match(/^https:\/\/[^/]+/)[0]);
  assert.ok(hosts.includes(OSM_TILE_HOST), 'the OSM host is no longer a tile host');

  const imgSrc = src => {
    const csp = src.match(/img-src ([^;]+);/);
    assert.ok(csp, 'no img-src in this Content-Security-Policy');
    return csp[1].trim().split(/\s+/);
  };
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

  for (const [where, list] of [['index.html', imgSrc(indexHtml)], ['vercel.json', imgSrc(vercelCsp)]]) {
    for (const host of hosts) {
      assert.ok(allows(list, host),
        `${where} img-src blocks ${host} — every tile 403s and the map draws blank`);
    }
  }
});

it('App.jsx holds no tile url of its own', () => {
  assert.ok(!/cartocdn|openstreetmap\.org\/\{z\}/.test(appCode),
    'a tile url is hardcoded in App.jsx again — it will not follow the key');
  assert.match(appCode, /from '\.\/mapTiles'/, 'App.jsx no longer imports the tile module');
});

it('every map spreads the derived props and carries the theme class', () => {
  const layers = appCode.match(/<TileLayer[^>]*\/>/g) || [];
  assert.ok(layers.length >= 5, `expected the app's map layers, found ${layers.length}`);
  for (const l of layers) {
    assert.match(l, /\{\.\.\.tileLayerProps\(\)\}/, `tile layer not using the derived props: ${l}`);
    // A prop written out beside the spread overrides it — which is how a
    // hardcoded url or a stale attribution gets back in.
    assert.ok(!/\b(url|attribution|subdomains)=/.test(l), `prop overriding the spread: ${l}`);
  }
  const maps = appCode.match(/<MapContainer[\s>][^>]*/g) || [];
  assert.equal(maps.length, layers.length,
    `${maps.length} maps but ${layers.length} tile layers`);
  for (const m of maps) {
    assert.match(m, /className=\{tileThemeClass\(\)\}/,
      `a map that will show light tiles in dark mode: ${m.slice(0, 80)}`);
  }
});

it('the env-reading wrappers agree with the builders they wrap', () => {
  // No VITE_CARTO_API_KEY under Node, so this is the keyless branch — the one
  // that ships today.
  assert.equal(usingCarto(), false);
  assert.equal(tileUrl(), buildTileUrl(''));
  assert.equal(tileAttribution(), buildAttribution(''));
  assert.equal(tileThemeClass(), buildTileClass(''));
  assert.deepEqual(Object.keys(tileLayerProps()).sort(), Object.keys(buildTileLayerProps('')).sort());
  // And they must not throw where there is no document either (SSR/prerender).
  assert.equal(typeof globalThis.document, 'undefined');
});

console.log(`\n  ${passed} checks passed\n`);
