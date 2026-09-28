// Which spots count as Northern Ireland, checked against the app's own list of
// where its cities are.
//
// src/regions.js was written because four different places printed "744 spots
// across Northern Ireland" over a dataset that included Dublin, Cork, Galway,
// Manchester, Glasgow, Edinburgh and Perth. Its header predicts exactly how it
// would break next: "County Donegal sticks up ABOVE most of Northern Ireland,
// so Malin Head and Dunfanaghy sit inside any box you would draw... If a
// Donegal pilot site is ever added, it needs a region, not a bigger box."
//
// The Gem Scout run then added gems in Malin Head and Dunfanaghy, and both were
// counted as Northern Ireland until they were named in NON_NI_CITIES. The
// prediction came true the first time it was tested by real data, which is the
// case for holding it in a test rather than a comment.
//
// THE INVARIANT, and why it is stronger than a list of towns: every town that
// has spots is also a city in App.jsx's CITIES, and CITIES already states the
// region. So the two must agree. Adding an island-wide town without deciding
// its region fails here instead of quietly inflating a headline.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { inNorthernIreland, NON_NI_CITIES, NI_BOUNDS } = await import('../../src/regions.js');
const { EXTRA_SPOTS } = await import('../../src/extraSpots.js');
const { EV_SPOTS } = await import('../../src/evSpots.js');

const app = readFileSync(new URL('../../src/App.jsx', import.meta.url), 'utf8');
const globe = readFileSync(new URL('../../public/globe/index.html', import.meta.url), 'utf8');

// CITIES is a plain literal in App.jsx and is not exported, so it is read from
// source — the same approach the other App.jsx tests use.
const CITY_REGION = {};
for (const m of app.matchAll(/\{ id:'([a-z ]+)',\s*name:'[^']*',\s*center:\[[-\d.,\s]+\],\s*region:'([^']+)' \}/g)) {
  CITY_REGION[m[1]] = m[2];
}

const spotsByTown = {};
for (const [town, list] of [...Object.entries(EXTRA_SPOTS), ...Object.entries(EV_SPOTS)]) {
  (spotsByTown[town] = spotsByTown[town] || []).push(...list);
}

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };

console.log('\nregionSplit — an NI claim counts only NI');

it('CITIES was parsed, or everything below proves nothing', () => {
  assert.ok(Object.keys(CITY_REGION).length >= 30,
    `only parsed ${Object.keys(CITY_REGION).length} cities from App.jsx — the regex has drifted`);
  assert.equal(CITY_REGION.belfast, 'Northern Ireland');
  assert.equal(CITY_REGION.dublin, 'Republic of Ireland');
});

it('every town that has spots is a city with a declared region', () => {
  const orphans = Object.keys(spotsByTown).filter(t => !CITY_REGION[t]);
  assert.deepEqual(orphans, [],
    `these towns have spots but no CITIES entry, so nothing states their region: ${orphans.join(', ')}`);
});

it('the region rule agrees with CITIES for every town, both ways', () => {
  // The whole invariant. A town CITIES calls Northern Ireland must classify as
  // NI, and one it places elsewhere must not — whichever side of NI_BOX its
  // coordinates happen to land on.
  const wrong = [];
  for (const [town, spots] of Object.entries(spotsByTown)) {
    const expected = CITY_REGION[town] === 'Northern Ireland';
    for (const s of spots) {
      if (inNorthernIreland({ town, lat: s.lat, lng: s.lng }) !== expected) {
        wrong.push(`${town}/${s.name} → counted ${expected ? 'outside' : 'inside'} NI`);
        break;
      }
    }
  }
  assert.deepEqual(wrong, [], `region rule disagrees with CITIES:\n  ${wrong.join('\n  ')}`);
});

it('the box is not quietly widened instead of naming towns', () => {
  // "If a Donegal pilot site is ever added, it needs a region, not a bigger
  // box." A widened box passes every outcome check — the named towns stay
  // excluded by name — while silently swallowing the NEXT Donegal or Louth
  // town nobody has named yet. Caught as a mutation that otherwise survived.
  //
  // Northern Ireland's real extent is roughly 54.0-55.3°N and -8.2 to -5.4°E;
  // Rathlin, its northernmost point, is about 55.3. A box reaching past 55.5
  // is no longer approximating Northern Ireland.
  assert.ok(NI_BOUNDS.latMax <= 55.5,
    `NI_BOX reaches ${NI_BOUNDS.latMax}°N — past Northern Ireland, so it now counts Donegal by geometry`);
  assert.ok(NI_BOUNDS.latMin >= 53.9,
    `NI_BOX starts at ${NI_BOUNDS.latMin}°N, reaching south into Louth and Meath`);
  assert.ok(NI_BOUNDS.lngMin >= -8.3,
    `NI_BOX reaches ${NI_BOUNDS.lngMin}°E, west into Donegal, Sligo and Mayo`);
  assert.ok(NI_BOUNDS.lngMax <= -5.3,
    `NI_BOX reaches ${NI_BOUNDS.lngMax}°E, east past the coast`);
});

it('the Donegal towns the header warned about are excluded BY NAME', () => {
  // These sit inside NI_BOX on geometry. Only the name list saves them, so the
  // test asserts the mechanism and not just the outcome — a "fix" that widened
  // or moved the box would still pass an outcome-only check on other towns.
  for (const town of ['malin head', 'dunfanaghy']) {
    assert.ok(NON_NI_CITIES.has(town), `${town} is not named in NON_NI_CITIES`);
    const inBox = town === 'malin head'
      ? { lat: 55.38, lng: -7.3735 } : { lat: 55.1878, lng: -7.9646 };
    assert.ok(inBox.lat > NI_BOUNDS.latMin && inBox.lat < NI_BOUNDS.latMax
      && inBox.lng > NI_BOUNDS.lngMin && inBox.lng < NI_BOUNDS.lngMax,
      `${town} is no longer inside NI_BOX — if the box moved, re-read the regions.js header before trusting it`);
    assert.equal(inNorthernIreland({ town, ...inBox }), false,
      `${town} counts as Northern Ireland`);
  }
});

it('the globe tiles agree with the scope its headline claims', () => {
  // THE PAIRING IS THE RULE, not either number. The page was headlined "Every
  // space Northern Ireland already has" and its tiles had to be spacesNi;
  // it is now headlined "Find parking anywhere" with the coverage stated in
  // the lede, so the tiles are the totals. Either is honest. Claiming one
  // scope and counting the other is not, and that is the only thing this
  // check forbids — which keeps it useful whichever way the page goes next.
  const h1 = globe.slice(globe.indexOf('<h1>'), globe.indexOf('</h1>') + 5);
  assert.ok(h1.length > 10, 'the headline is gone');
  const fn = globe.slice(globe.indexOf('function paintStats'),
                         globe.indexOf('function paintStats') + 1800);
  const claimsNiOnly = /Northern Ireland/i.test(h1);
  const tilesAreNi = /stats\.spacesNi/.test(fn);

  assert.equal(tilesAreNi, claimsNiOnly, claimsNiOnly
    ? 'the headline says Northern Ireland but the tiles count the whole island'
    : 'the headline no longer says Northern Ireland, so the tiles should be the totals');

  // Whichever side it is on, all three tiles must be on the SAME side: two
  // island numbers beside one NI number is the worst of both.
  const fields = ['spaces', 'gems', 'towns']
    .map(k => new RegExp(`stats\\.${k}Ni`).test(fn));
  assert.equal(new Set(fields).size, 1,
    `the three tiles disagree with each other about scope: ${JSON.stringify(fields)}`);
});

it('the generated data still carries both counts, and they differ', () => {
  const stats = JSON.parse(readFileSync(
    new URL('../../public/globe/places.json', import.meta.url), 'utf8')).stats;
  for (const k of ['spaces', 'gems', 'towns', 'spacesNi', 'gemsNi', 'townsNi']) {
    assert.equal(typeof stats[k], 'number', `stats.${k} is missing from the generated data`);
  }
  // If these ever match again the dataset has gone NI-only, and the tiles being
  // NI figures is then harmless rather than load-bearing — but it is worth
  // knowing, because it means this guard has stopped guarding anything.
  assert.ok(stats.spacesNi < stats.spaces,
    'spacesNi equals the total — the dataset is NI-only again, so re-check whether this split is still needed');
  assert.ok(stats.spacesNi > 0, 'no spots count as Northern Ireland at all, which cannot be right');
});

console.log(`\n  ${passed} checks passed\n`);
