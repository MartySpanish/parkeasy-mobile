// "Across Northern Ireland" has to be true.
//
// The homepage said "744 parking spots across Northern Ireland". Ninety of them
// were in Dublin, Cork, Galway, Manchester, Glasgow, Edinburgh and Perth. The
// gems had the mirror-image fault: 133 published, 28 of them in the Republic.
//
// Four surfaces print these numbers — the prerendered SEO text, the three meta
// descriptions, the globe card and the hero — and each was counting its own
// way. These checks hold them to one rule, and hold that rule to the one
// failure that costs something: counting a spot that is not in Northern
// Ireland. A spot wrongly left out makes the number smaller, which is
// survivable. A spot wrongly counted makes the sentence false.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inNorthernIreland, NON_NI_CITIES } from '../../src/regions.js';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const app       = read('../../src/App.jsx');
const generator = read('../../scripts/generate-globe-data.mjs');
const globe     = read('../../src/components/home/CoverageGlobe.jsx');

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };

console.log('\nregions — "across Northern Ireland" has to be true');

it('the six places the bundled data leaves Northern Ireland are excluded', () => {
  // Real coordinates from the pilot and APCOA datasets.
  const outside = [
    ['Dublin',     { lat: 53.33, lng: -6.28,  _city: 'dublin' }],
    ['Cork',       { lat: 51.88, lng: -8.44,  _city: 'cork' }],
    ['Galway',     { lat: 53.26, lng: -9.07,  _city: 'galway' }],
    ['Manchester', { lat: 53.48, lng: -2.24,  _city: 'manchester' }],
    ['Glasgow',    { lat: 55.86, lng: -4.25,  _city: 'glasgow' }],
    ['Edinburgh',  { lat: 55.95, lng: -3.19,  _city: 'edinburgh' }],
    ['Perth',      { lat: 56.40, lng: -3.43,  _city: 'perth' }],
  ];
  for (const [name, spot] of outside) {
    assert.equal(inNorthernIreland(spot), false, `${name} is being counted as Northern Ireland`);
  }
});

it('Northern Irish towns are kept, including the western ones', () => {
  const inside = [
    ['Belfast',     { lat: 54.5831, lng: -5.9858 }],
    ['Derry',       { lat: 55.0030, lng: -7.3300 }],
    ['Enniskillen', { lat: 54.3460, lng: -7.6420 }],
    ['Strabane',    { lat: 54.8290, lng: -7.4670 }],
    ['Portrush',    { lat: 55.2060, lng: -6.6560 }],
  ];
  for (const [name, spot] of inside) {
    assert.equal(inNorthernIreland(spot), true, `${name} is being dropped from the count`);
  }
});

it('County Donegal is not Northern Ireland, however close it looks', () => {
  // THE failure a bounding box cannot avoid: Donegal reaches further north
  // than any part of Northern Ireland, so these two sit inside any rectangle
  // you would draw. They are excluded by the region the database gives them,
  // not by geometry.
  assert.equal(inNorthernIreland({ lat: 55.38, lng: -7.374, region: 'ROI' }), false,
    'Malin Head is being counted as Northern Ireland');
  assert.equal(inNorthernIreland({ lat: 55.188, lng: -7.965, region: 'ROI' }), false,
    'Dunfanaghy is being counted as Northern Ireland');
  // And the box alone would have got both wrong — which is why region wins.
  assert.equal(inNorthernIreland({ lat: 55.38, lng: -7.374 }), true,
    'the bounding box no longer contains Malin Head, so this test proves nothing');
});

it('a known non-NI city beats the box, not the other way round', () => {
  // Every real non-NI spot today is also far outside the bounding box, so the
  // box alone would pass the checks above and the city list would look
  // redundant. It is not: it is what protects against a spot whose
  // coordinates put it inside Northern Ireland but whose city is not — a
  // future Donegal or Dundalk pilot, or simply a mistyped coordinate. This
  // case is the only one in the file that tells the two mechanisms apart.
  assert.equal(inNorthernIreland({ lat: 54.59, lng: -5.93, _city: 'dublin' }), false,
    'a Dublin-tagged spot with Belfast coordinates is being counted as Northern Ireland');
  // Proving the box would have said yes, so the assertion above means something.
  assert.equal(inNorthernIreland({ lat: 54.59, lng: -5.93 }), true,
    'those coordinates are no longer inside the box, so the check above proves nothing');
});

it('an explicit region always beats the box', () => {
  assert.equal(inNorthernIreland({ lat: 53.33, lng: -6.28, region: 'NI' }), true,
    'an explicit NI region is being ignored');
  assert.equal(inNorthernIreland({ lat: 54.59, lng: -5.93, region: 'ROI' }), false,
    'an explicit ROI region is being ignored');
});

it('anything unplaceable drops out rather than inflating the count', () => {
  for (const spot of [null, undefined, {}, { lat: null, lng: null }, { lat: '54.5', lng: '-5.9' }]) {
    assert.equal(inNorthernIreland(spot), false,
      `an unplaceable spot (${JSON.stringify(spot)}) is being counted`);
  }
});

it('the NI breakdown is still computed, from the one rule', () => {
  // The homepage now names all three territories, so the headline is NOT
  // NI-scoped — but the Northern Ireland numbers are still recorded, because
  // they are what any Northern-Ireland-only claim has to use, and because
  // getting them wrong is what started this.
  assert.match(generator, /import \{ inNorthernIreland \} from '\.\.\/src\/regions\.js'/,
    'the build script no longer uses the shared rule');
  assert.match(generator, /spacesNi: niSpaces\.length/,
    'the build script no longer records the Northern Ireland subset');

  const stats = JSON.parse(read('../../public/globe/places.json')).stats;
  for (const k of ['spaces', 'gems', 'towns', 'ev', 'spacesNi', 'gemsNi', 'townsNi', 'evNi']) {
    assert.ok(Number.isInteger(stats[k]), `stats.${k} is missing or not a number`);
  }
  assert.ok(stats.spacesNi < stats.spaces,
    'the NI subset equals the whole network — the filter is not being applied');
  assert.ok(stats.townsNi <= stats.towns, 'more NI towns than towns');
});

it('no numbered claim says "across Northern Ireland" on its own', () => {
  // Ninety of the mapped spots are in Dublin, Cork, Galway, Manchester,
  // Glasgow, Edinburgh and Perth. A number followed by "across Northern
  // Ireland" full stop is the false sentence this all started with.
  const html = read('../../index.html');
  const prerender = read('../../scripts/prerender.mjs');
  const claims = [
    ...[...html.matchAll(/\{\{SPOTS\}\}[^"]*?across Northern Ireland(.{0,30})/g)],
    ...[...prerender.matchAll(/NETWORK\.spots\} [^`]*?across Northern Ireland(.{0,30})/g)],
  ];
  assert.ok(claims.length >= 3, `only ${claims.length} numbered claims found — the copy may have moved`);
  for (const m of claims) {
    assert.match(m[1], /^,\s*the Republic and Britain/,
      `a numbered claim still reads "across Northern Ireland" alone: ...${m[0].slice(-70)}`);
  }
});

it('the non-NI city list is a list, not a guess', () => {
  for (const c of ['dublin', 'cork', 'galway', 'manchester', 'glasgow', 'edinburgh', 'perth']) {
    assert.ok(NON_NI_CITIES.has(c), `${c} has fallen off the non-NI city list`);
  }
});

console.log(`\n  ${passed} checks passed\n`);
