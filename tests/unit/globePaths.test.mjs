// The globe's assets must be absolute, and this is why.
//
// THE BUG THIS EXISTS FOR. vercel.json rewrites /globe to /globe/index.html.
// A rewrite is not a redirect — the browser's address bar keeps "/globe", with
// no trailing slash. A relative "./d3.min.js" therefore resolves against "/"
// and requests "/d3.min.js" at the site ROOT, which 404s. d3 never loads, the
// script throws "d3 is not defined", and the page still paints its heading,
// its search box, its filter chips and its legend — everything except the
// globe. It reads as a broken globe rather than a broken path, and it shipped.
//
// Every one of these loads at page level, so any single relative path brings
// the whole page down. Checked as source text: the page is plain HTML with an
// inline script and cannot be imported.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../../public/globe/index.html', import.meta.url), 'utf8');
const vercel = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };

console.log('\nglobePaths — /globe is a rewrite, so nothing may be relative');

it('the rewrite this all depends on is still there', () => {
  const r = vercel.rewrites?.find(x => x.source === '/globe');
  assert.ok(r, 'vercel.json no longer rewrites /globe');
  assert.equal(r.destination, '/globe/index.html');
});

it('the SPA catch-all still comes after it', () => {
  // If the catch-all were first, /globe would serve the React app instead.
  const srcs = vercel.rewrites.map(r => r.source);
  const globe = srcs.indexOf('/globe');
  const catchAll = srcs.findIndex(s => s.includes('(?!api/)'));
  assert.ok(catchAll === -1 || globe < catchAll,
    'the SPA catch-all precedes /globe — /globe would serve the app, not the globe');
});

it('no script tag on the globe page is relative', () => {
  const bad = [...html.matchAll(/<script[^>]*\ssrc=["']([^"']+)["']/g)]
    .map(m => m[1])
    .filter(src => !/^(https?:)?\/\//.test(src) && !src.startsWith('/globe/'));
  assert.deepEqual(bad, [], `relative script src on /globe: ${bad.join(', ')}`);
});

it('no d3.json() load on the globe page is relative', () => {
  const bad = [...html.matchAll(/d3\.json\(\s*['"]([^'"]+)['"]/g)]
    .map(m => m[1])
    .filter(u => !/^(https?:)?\/\//.test(u) && !u.startsWith('/globe/'));
  assert.deepEqual(bad, [], `relative d3.json() on /globe: ${bad.join(', ')}`);
});

it('every local file the page asks for is one the build produces', () => {
  // A path that is absolute but wrong fails exactly as loudly as a relative one.
  const SHIPPED = new Set([
    '/globe/config.js', '/globe/d3.min.js', '/globe/topojson-client.min.js',
    '/globe/countries-110m.json', '/globe/ni-ireland.json', '/globe/places.json',
  ]);
  const asked = [
    ...[...html.matchAll(/<script[^>]*\ssrc=["']([^"']+)["']/g)].map(m => m[1]),
    ...[...html.matchAll(/d3\.json\(\s*['"]([^'"]+)['"]/g)].map(m => m[1]),
  ].filter(u => u.startsWith('/globe/'));
  assert.ok(asked.length >= 6, `expected at least 6 local loads, found ${asked.length}`);
  for (const u of asked) assert.ok(SHIPPED.has(u), `${u} is not a file the build writes`);
});

it('the host split is not quoted on the globe', () => {
  // Pulled at Marty's call — a treasurer reading a percentage is doing
  // arithmetic, not signing up. The number still lives on /hosts.
  assert.ok(!/Kept by the host/i.test(html), 'the 85% tile is back on the globe');
});

console.log(`\n  ${passed} checks passed\n`);
