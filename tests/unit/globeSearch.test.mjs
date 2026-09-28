// Searching the globe for somewhere we have never heard of.
//
// The admin dashboard carries a list titled "Searched, nothing to book — the
// supply list": Aspire Lounge, Belfast International, Cromore Road, Grand
// Central, Tesco Larne Road. Every one of those was a real driver typing a real
// place into a box that answered "Nothing matches that." The search only knew
// 25 hand-placed towns and the names of spots we already held, so a driver
// asking for anywhere else hit a wall with no way past it.
//
// Now an unrecognised search is geocoded, the globe flies there, and the
// nearest mapped spaces are listed by distance. Where there is nothing, the
// answer is "nothing mapped near X yet" at the right place on the map — still
// a no, but an honest and useful one.
//
// The globe is one inline <script> in a plain HTML file and cannot be
// imported, so the wiring is checked as source text; the pure geometry is
// lifted out and actually run.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const globe = readFileSync(new URL('../../public/globe/index.html', import.meta.url), 'utf8');
const script = globe.slice(globe.indexOf('<script>\nconst BELFAST'));

const lift = (name, re) => {
  const m = script.match(re);
  assert.ok(m, `${name} is gone from the globe`);
  return m[0];
};
// The real haversine, run rather than pattern-matched.
const kmBetween = new Function(
  'R_EARTH',
  lift('kmBetween', /function kmBetween\(a, b\) \{[\s\S]*?\n\}/) + '\nreturn kmBetween;',
)(6371);

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };

console.log('\nglobeSearch — a search we do not recognise is not a dead end');

//------------------------------------------------------------------ geometry
it('distance is real great-circle distance, not flat arithmetic', () => {
  const belfast = [-5.9301, 54.5973], dublin = [-6.2603, 53.3498];
  const d = kmBetween(belfast, dublin);
  // Belfast to Dublin is about 141 km as the crow flies.
  assert.ok(d > 135 && d < 148, `Belfast→Dublin came out as ${d.toFixed(1)}km`);
  assert.equal(kmBetween(belfast, belfast), 0, 'a point is not zero km from itself');
  // Symmetric, and longitude must be scaled by latitude — the mistake that
  // makes east-west distances wrong the further from the equator you go.
  assert.ok(Math.abs(kmBetween(dublin, belfast) - d) < 1e-9, 'distance is not symmetric');
  const eastWestAt55 = kmBetween([0, 55], [1, 55]);
  const eastWestAt0 = kmBetween([0, 0], [1, 0]);
  assert.ok(eastWestAt55 < eastWestAt0 * 0.62,
    'a degree of longitude at 55°N is being treated as wide as one at the equator');
});

//------------------------------------------------------------------- wiring
it('an unmatched search reaches the geocoder, by intent not by keystroke', () => {
  // Nominatim asks for at most one request a second. Firing per keystroke
  // would breach that and hammer a free service on somebody else's goodwill.
  assert.match(script, /addEventListener\('input', renderList\)/,
    'typing no longer re-renders the list');
  const onKey = script.slice(script.indexOf("addEventListener('keydown', e =>"));
  assert.match(onKey.slice(0, 600), /else goAnywhere\(/,
    'Enter on an unrecognised search no longer looks it up');
  assert.ok(!/addEventListener\('input',[^)]*goAnywhere/.test(script),
    'the geocoder is wired to every keystroke, which breaches the usage policy');
  // What we hold wins, so "Belfast" is our Belfast.
  const order = onKey.slice(0, 600);
  assert.ok(order.indexOf('selectTown') < order.indexOf('goAnywhere'),
    'the geocoder is consulted before our own towns');
});

it('a lookup is cached, misses included', () => {
  const fn = script.slice(script.indexOf('async function geocode'),
                          script.indexOf('const R_EARTH'));
  assert.match(fn, /geoCache\.has\(key\)/, 'repeat searches hit the network again');
  assert.match(fn, /geoCache\.set\(key, hit\)/, 'nothing is cached');
  // The miss must be cached too, or a typo retried three times is three
  // requests against a one-a-second budget.
  assert.ok(!/if \(hit\) geoCache\.set/.test(fn), 'a failed lookup is not cached, so a typo costs a request every retry');
});

it('a found place flies the camera and lists what is near it', () => {
  const fn = script.slice(script.indexOf('async function goAnywhere'),
                          script.indexOf('async function goAnywhere') + 1500);
  assert.match(fn, /goTo\('city', \{ \.\.\.hit, adhoc: true \}\)/,
    'the globe no longer moves to the place that was found');
  assert.match(fn, /renderList\(\)/, 'the list is not refreshed after moving');
  // adhoc is what tells the list to work by distance rather than by town name.
  const list = script.slice(script.indexOf('function renderList'),
                            script.indexOf('function countIn'));
  assert.match(list, /city\.adhoc/, 'the list does not special-case a searched point');
  assert.match(list, /nearestTo\(city\.c\)/, 'the nearest spaces are not listed');
  assert.match(list, /_km/, 'the distance is computed but never shown');
});

it('a space on another continent is not offered as "nearest"', () => {
  // Found by driving a real search: "Tokyo" returned a car park in Perth,
  // 7,920 km away, because it was globally the closest thing we hold. Every
  // row was factually true and the list as a whole was a lie about coverage.
  const fn = script.slice(script.indexOf('function nearestTo'),
                          script.indexOf('function nearestTo') + 500);
  assert.match(fn, /maxKm = NEAREST_KM/, 'the radius cap is gone');
  assert.match(fn, /\.filter\(x => x\.km <= maxKm\)/,
    'results are no longer limited by distance, so a far-flung search lists another continent');
  const km = script.match(/const NEAREST_KM = (\d+)/);
  assert.ok(km, 'NEAREST_KM is gone');
  assert.ok(Number(km[1]) > 0 && Number(km[1]) <= 50,
    `NEAREST_KM is ${km[1]} km — past what anyone drives to park and walk`);
});

it('the failure paths all say something true', () => {
  const fn = script.slice(script.indexOf('async function goAnywhere'),
                          script.indexOf('async function goAnywhere') + 1800);
  assert.match(fn, /Could not find/, 'a place that does not exist gets no answer');
  assert.match(fn, /Could not reach the place lookup/,
    'a network failure is indistinguishable from a place that does not exist');
  assert.match(fn, /finally \{\s*geoBusy = false/,
    'geoBusy is never cleared on failure, so one error disables search for the session');
  // And the case that matters most for an empty market: we went there and
  // have nothing. That must not read as a search failure.
  const list = script.slice(script.indexOf('function renderList'),
                            script.indexOf('function countIn'));
  // Names the radius, so "nothing" is a bounded claim rather than a vague one.
  assert.match(list, /Nothing mapped within ' \+ NEAREST_KM \+ ' km of/,
    'landing somewhere with no spaces gives no explanation, or no longer says how far it looked');
});

//-------------------------------------------------------------- town folding
it('every town in the data becomes searchable, not just the hand-placed 25', () => {
  const fn = script.slice(script.indexOf('function foldInDataTowns'),
                          script.indexOf('function foldInDataTowns') + 900);
  assert.ok(fn.length > 200, 'foldInDataTowns is gone');
  assert.match(fn, /seen\.has\(p\.town\)/, 'hand-placed towns are being duplicated');
  assert.match(fn, /rank: 2/, 'derived towns can now outrank the hand-placed labels');
  assert.match(script, /foldInDataTowns\(PLACES\)/, 'the fold never runs');
  // ARCS must NOT be rebuilt: they run to Belfast and read as the NI network.
  const after = script.slice(script.indexOf('foldInDataTowns(PLACES)'));
  assert.ok(!/ARCS\s*=/.test(after.slice(0, 400)),
    'the Belfast arcs are being rebuilt to include towns in the Republic');
});

it('the towns actually in the data are covered by the fold', () => {
  const places = JSON.parse(readFileSync(
    new URL('../../public/globe/places.json', import.meta.url), 'utf8'));
  const dataTowns = new Set(places.spaces.map(s => s.town).filter(Boolean));
  const hardcoded = new Set(
    [...script.matchAll(/\{ n: "([^"]+)", c: \[/g)].map(m => m[1]));
  const missing = [...dataTowns].filter(t => !hardcoded.has(t));
  // There MUST be towns only the fold covers, or the fold is dead code and
  // this test is guarding nothing.
  assert.ok(missing.length > 0,
    'every town is hand-placed again, so foldInDataTowns no longer does anything');
  assert.ok(dataTowns.size > hardcoded.size,
    `the data has ${dataTowns.size} towns and ${hardcoded.size} are hand-placed`);
});

console.log(`\n  ${passed} checks passed\n`);
