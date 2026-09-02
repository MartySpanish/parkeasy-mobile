// The globe in the app, and the three ways it could quietly become expensive.
//
// This is decoration on the landing page of a mobile app, so its cost is the
// whole story. Each check below guards a change that would look harmless in a
// diff and would not fail anything else:
//
//   1. Someone imports CoverageGlobe normally instead of via React.lazy. The
//      page still works, and d3-geo lands in the main bundle that every driver
//      downloads before they can search.
//   2. Someone imports from 'd3' instead of 'd3-geo'. The globe still draws,
//      and the chunk goes from ~29 KB to ~300 KB.
//   3. Someone drops the IntersectionObserver or the reduced-motion guard. The
//      globe still spins — permanently, off screen, on a phone.
//
// Nothing here renders React; the component needs a canvas and a DOM. These are
// the structural facts, checked against the source and the built output.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const src  = readFileSync(new URL('../../src/components/home/CoverageGlobe.jsx', import.meta.url), 'utf8');
const app  = readFileSync(new URL('../../src/App.jsx', import.meta.url), 'utf8');
const pkg  = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };

console.log('\ncoverageGlobe — the globe stays cheap');

it('the app loads it lazily, never as a plain import', () => {
  assert.match(app, /const CoverageGlobe = React\.lazy\(\(\) => import\('\.\/components\/home\/CoverageGlobe'\)\)/,
    'CoverageGlobe is no longer React.lazy()');
  // A second, eager import anywhere would defeat the split entirely.
  const eager = app.match(/^import .*CoverageGlobe.*$/m);
  assert.equal(eager, null, `CoverageGlobe is also imported eagerly: ${eager?.[0]}`);
  assert.match(app, /<React\.Suspense fallback=\{null\}>\s*<CoverageGlobe/,
    'CoverageGlobe is not wrapped in Suspense — React will throw when it loads');
});

it('only d3-geo is pulled in, not all of d3', () => {
  assert.match(src, /from 'd3-geo'/, "the globe no longer imports from 'd3-geo'");
  assert.ok(!/from ['"]d3['"]/.test(src), "the globe imports all of d3 — that is ~270 KB for five functions");
  assert.ok(!pkg.dependencies.d3, 'the full d3 package is now a dependency');
  for (const dep of ['d3-geo', 'topojson-client']) {
    assert.ok(pkg.dependencies[dep], `${dep} is missing from dependencies`);
  }
});

it('it does no work while off screen', () => {
  assert.match(src, /new IntersectionObserver/,
    'the IntersectionObserver is gone — the globe would spin off screen forever');
  assert.match(src, /if \(visible\) \{ rotation/,
    'the animation loop no longer checks visibility before drawing');
});

it('it does not move for a viewer who asked for less motion', () => {
  assert.match(src, /prefers-reduced-motion/, 'the reduced-motion check is gone');
  assert.match(src, /if \(!reduced\) raf = requestAnimationFrame/,
    'the animation now starts regardless of the reduced-motion preference');
});

it('the heavy data waits for the card to be scrolled to', () => {
  // The fetches must live inside the observer callback's load(), not at mount.
  const load = src.slice(src.indexOf('const load = async ()'), src.indexOf('// ── Drawing'));
  for (const f of ['countries-110m.json', 'ni-ireland.json', 'places.json']) {
    assert.ok(load.includes(f), `${f} is fetched outside the visibility-gated load()`);
  }
  assert.match(src, /if \(visible\) load\(\)/, 'load() is no longer gated on visibility');
});

it('the two data files are decoded the way each actually is', () => {
  // The bug this replaces: ni-ireland.json is NOT topojson, and decoding it
  // threw, which made the card delete itself on a page that still looked fine.
  assert.match(src, /merge\(world, world\.objects\.countries\.geometries\)/,
    'the world outline is no longer merged from topojson');
  assert.match(src, /ireland: ni\.ireland/, 'ni-ireland.json is being decoded rather than read directly');
  assert.ok(!/feature\(/.test(src), 'ni-ireland.json is plain GeoJSON — feature() on it throws');
});

it('the numbers come from the app, not from a person typing', () => {
  const call = /<CoverageGlobe\s*([\s\S]*?)\/>/.exec(app)?.[1] ?? '';
  assert.match(call, /spaces=\{ALL_SPOTS_STATS\.length\}/, 'the space count is hardcoded');
  assert.match(call, /hidden_gem'\)\.length\}/,             'the gem count is hardcoded');
  assert.match(call, /towns=\{CITIES\.length\}/,            'the town count is hardcoded');
});

it('a failed load removes the card instead of leaving a hole', () => {
  assert.match(src, /if \(failed\) return null;/,
    'the globe no longer removes itself when its data cannot load');
});

// ── The built output, when there is one ─────────────────────────────────────
const dist = new URL('../../dist/assets/', import.meta.url);
if (existsSync(dist)) {
  it('it ships as its own chunk, and d3-geo is not in the main bundle', () => {
    const files = readdirSync(dist);
    const globe = files.find(f => /^CoverageGlobe-.*\.js$/.test(f));
    const main  = files.find(f => /^index-.*\.js$/.test(f));
    assert.ok(globe, 'no CoverageGlobe chunk was emitted — it is in the main bundle');
    assert.ok(main, 'no main bundle found');
    // geoOrthographic is d3-geo's fingerprint: if it appears in the main
    // bundle, the code splitting has stopped working.
    const mainSrc = readFileSync(new URL(main, dist), 'utf8');
    assert.ok(!mainSrc.includes('geoOrthographic'),
      'd3-geo has leaked into the main bundle');
  });
} else {
  console.log('  SKIP  built-output checks (no dist/ — run `npm run build` first)');
}

console.log(`\n  ${passed} checks passed\n`);
