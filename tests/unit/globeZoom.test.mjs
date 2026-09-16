// Selecting a space on /globe used to bring you no closer.
//
// selectPlace() called goTo('city', theTown). So picking Wellington Place and
// picking Cave Hill produced the identical camera — the town, 30km across — and
// picking anything at all while already looking at Belfast moved the camera
// nowhere. The panel filled in, the map sat still, and 744 spaces stayed as
// indistinguishable dots. It took a photograph of the screen.
//
// WHAT THIS FILE CAN AND CANNOT DO. /globe is a standalone page: one HTML file
// with an inline script that draws to a canvas through d3. There is no module
// to import and no DOM in Node, so the camera wiring is asserted against the
// source — deliberately, with each check phrased as the behaviour it protects.
// The two numeric helpers ARE run for real: they are extracted from the page
// and evaluated, because "which rings fit this viewport" is arithmetic, and
// arithmetic asserted by grep is arithmetic nobody has tested.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const globe = read('../../public/globe/index.html');

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };

console.log('\nglobeZoom — selecting a space has to take you somewhere');

//------------------------------------------------------ the rings, for real
// COMMENTS ARE STRIPPED, and this is the sixth time in this suite that a check
// has fired on its own documentation: the comment inside selectPlace explains
// that goTo('city', town) WAS the bug, and a grep for that string finds it
// there. The rule is now in the helper rather than in each caller's head.
const stripComments = src => src
  .replace(/^\s*\/\*[\s\S]*?\*\//gm, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/([^:])\/\/[^'"\n]*$/gm, '$1');

const cut = (from, to, { comments = false } = {}) => {
  const a = globe.indexOf(from);
  const b = globe.indexOf(to, a);
  assert.ok(a > 0 && b > a, `could not find ${from} … ${to} in the globe page`);
  const src = globe.slice(a, b + to.length);
  return comments ? src : stripComments(src);
};
const ringSrc = cut('const RING_LADDER', "const ringLabel = km => (km < 1 ? Math.round(km * 1000) + ' M' : km + ' KM');", { comments: true });
const { ringsFor, ringLabel } = new Function(ringSrc + '\nreturn { ringsFor, ringLabel };')();

it('the rings are the ones that fit, not a fixed 2/5/10', () => {
  // A 2.5km-wide street view: about 256px to the kilometre.
  const close = ringsFor(256, 420);
  assert.deepEqual(close, [0.25, 0.5, 1],
    `a street-level view got ${JSON.stringify(close)} — at 256px/km the old fixed `
    + '2/5/10 put one ring across the whole frame and two off the screen');

  // A 30km town view: about 21px to the kilometre.
  const town = ringsFor(21, 420);
  assert.deepEqual(town, [2, 5, 10], `the town view lost its rings: ${JSON.stringify(town)}`);

  // Every ring returned must actually be on screen and big enough to read.
  for (const [kmPx, maxPx] of [[256, 420], [21, 420], [21, 120], [1200, 300], [0.02, 500]]) {
    for (const km of ringsFor(kmPx, maxPx)) {
      assert.ok(km * kmPx < maxPx, `a ${km}km ring at ${kmPx}px/km does not fit in ${maxPx}px`);
      assert.ok(km * kmPx > 26, `a ${km}km ring at ${kmPx}px/km is too small to label`);
    }
  }
  assert.ok(ringsFor(21, 120).length >= 1, 'a short viewport got no rings at all');
  // A tall frame at town scale has five candidates on the ladder, so this is
  // where the cap does its work — at street level only three ever qualify and
  // removing the cap changed nothing.
  assert.ok(ringsFor(21, 2000).length <= 3,
    `${ringsFor(21, 2000).length} rings — more than three is noise`);

  // And the close-up has to ASK. Re-fixing the list at the call site puts the
  // 2/5/10 rings back over a street view with every helper still in place.
  const fn = cut('function closeUp(now, a)', '\n}');
  assert.match(fn, /ringsFor\(kmPx, /, 'the close-up no longer asks which rings fit');
  assert.ok(!/\[2, 5, 10\]/.test(fn), 'the close-up has a hardcoded ring list again');
});

it('a sub-kilometre ring is labelled in metres', () => {
  assert.equal(ringLabel(0.25), '250 M');
  assert.equal(ringLabel(0.5), '500 M');
  assert.equal(ringLabel(1), '1 KM');
  assert.equal(ringLabel(10), '10 KM');
  // "0.25 KM" is not how anybody says it.
  for (const km of [0.1, 0.25, 0.5]) assert.match(ringLabel(km), / M$/, `${km} was labelled in km`);
});

//---------------------------------------------------------- the camera
it('selecting a space flies to the space, not to its town', () => {
  const fn = cut('function selectPlace(p)', '\n}');
  assert.match(fn, /goTo\('place', p\)/,
    "selectPlace goes somewhere other than the place — goTo('city', town) is the "
    + 'bug: every space in a town produced the same camera');
  assert.ok(!/goTo\('city'/.test(fn), 'selectPlace still zooms to the town');
});

it('the place camera is centred on that place, at a street-level scale', () => {
  const fn = cut('function cameraFor(m, target)', '\n}');
  const branch = fn.slice(fn.indexOf("m === 'place'"), fn.indexOf("m === 'city'"));
  assert.match(branch, /lambda: -target\.c\[0\]/, 'the place camera is not centred on the place');
  assert.match(branch, /phi: -target\.c\[1\]/, 'the place camera is not centred on the place');
  assert.match(branch, /scale: placeScale/, 'the place camera does not zoom in');

  // And placeScale has to actually be closer than the town. Both are derived
  // from a distance across the frame, so compare those.
  const fits = cut('function computeFits()', '\n}');
  // Both scales are written as "(a fraction of the frame) / (km / 6371)", so
  // the kilometres each one frames can be read straight out of the source.
  const framed = Object.fromEntries(
    [...fits.matchAll(/(cityScale|placeScale) = \(Math\.min\(W, H\) \* [\d.]+\) \/ \(([\d.]+) \/ 6371\)/g)]
      .map(m => [m[1], Number(m[2])]));
  for (const n of ['cityScale', 'placeScale']) {
    assert.ok(framed[n], `${n} is no longer derived from a distance across the frame`);
  }
  const city = framed.cityScale, place = framed.placeScale;

  assert.ok(place < city / 4,
    `placeScale frames ${place}km against the town's ${city}km — not enough closer to be worth flying`);
  assert.ok(place >= 1, `${place}km across is closer than a street; the space would have no context`);
});

it('mode place keeps the selection and the town context', () => {
  const fn = cut('function goTo(m, target)', '\n}');
  assert.match(fn, /else if \(m === 'place'\) \{ city = townByName\[target\.town\]/,
    'place mode loses the town, so the close-up has no area labels to draw');
  assert.match(fn, /selected = target/, 'place mode does not record what was selected');
  // The old line cleared the selection for anything that was not 'city'.
  assert.ok(!/if \(m !== 'city'\) selected = null/.test(fn),
    'place mode clears the selection it was just given');
});

it('the drift is scaled to the frame, not copied from the town view', () => {
  const loop = cut('} else if ((mode === ', 'projection.rotate(');
  assert.match(loop, /mode === 'place'/, 'the flyover does not run in place mode');
  assert.match(loop, /const amp = mode === 'place' \? 0\.0?\d+ : 1/,
    'the flyover amplitude is not reduced at street level');
  // Every wobble term has to be multiplied by it, or the camera swings the
  // space in and out of shot.
  const terms = loop.match(/(0\.009 \* lonScale|0\.006|0\.045|\* 6|\* 4)/g) || [];
  assert.ok(terms.length >= 5, 'the flyover changed shape — re-check the amplitudes');
  for (const line of loop.split('\n').filter(l => /Math\.(sin|cos)\(s \*/.test(l))) {
    assert.match(line, /amp/, `a drift term with no amplitude scaling: ${line.trim()}`);
  }
});

it('a resize keeps pointing at the place, and rebuilds the drift base', () => {
  const fn = cut('function resize()', '\n}');
  assert.match(fn, /cameraFor\(mode, mode === 'place' \? selected : city\)/,
    'a resize in place mode re-aims the camera at the town');
  assert.match(fn, /cityBase = \{ \.\.\.view \}/,
    'the flyover base is not rebuilt, so the camera drifts around the old viewport');
});

it('backing out of a space pulls the camera back out too', () => {
  const back = globe.slice(globe.indexOf("document.getElementById('d-back').onclick"));
  const body = back.slice(0, back.indexOf('};') + 2);
  assert.match(body, /goTo\('city', t\)/,
    'the list says "all spaces" while the map is still parked two streets away');
});

//---------------------------------------------------------- the labels
it('the rings and the neighbours are measured from the selected space', () => {
  const fn = cut('function closeUp(now, a)', '\n}');
  assert.match(fn, /const focus = \(mode === 'place' && selected\) \? selected : city/,
    'the close-up still measures everything from the town centre');
  // The `here` filter specifically: kmFrom() also mentions focus.c, so a check
  // for the name alone passed while the filter had been switched back to the
  // town centre.
  const filter = fn.slice(fn.indexOf('const here = PLACES.filter'), fn.indexOf('const order ='));
  assert.match(filter, /d3\.geoDistance\(p\.c, focus\.c\)/,
    'the neighbours are chosen by distance from the town, so a space on the edge '
    + 'of the city looks out over an empty screen');
  assert.ok(!/city\.c/.test(filter), 'the neighbour filter still measures from the town centre');
  assert.match(fn, /const reach = mode === 'place' \? \d+ : 26/,
    'street level pulls in the whole city');
});

it('the selected space is always named, and named loudest', () => {
  const fn = cut('function closeUp(now, a)', '\n}');
  assert.match(fn, /isSel\(p\)\s*\n?\s*\? \{ size: 13, weight: 800, colour: '#FFFFFF'/,
    'the selected space is drawn like its neighbours — findable only by reading '
    + 'every label on the screen');
  assert.match(fn, /force: true/,
    'the one label this view exists for can still be dropped for want of room');
  assert.match(fn, /if \(sel\) named\.unshift\(sel\)/,
    'the selected label is not placed first, so a neighbour can take its spot');
  // The town name waits: on a narrow screen BELFAST took the only box the
  // space's name could have fitted in, and the space went unlabelled.
  assert.match(fn, /if \(mode !== 'place'\) townLabel\(\)/, 'the town label no longer yields');
  assert.match(fn, /if \(mode === 'place'\) townLabel\(\)/, 'the town is never named at street level');
});

it('a label never runs off the map or over the panel', () => {
  const fn = cut('function label(text, p, placed, o)', '\n}');
  assert.match(fn, /const b = labelBounds\(\)/, 'labels are no longer bounded');
  assert.match(fn, /!inside\(r\) \|\| placed\.some/,
    'a position that runs off the canvas is still accepted — clipped text reads as a bug');
  const bounds = cut('function labelBounds()', '\n}');
  assert.match(bounds, /x0: mapLeft\(\) \+ \d+/, 'labels can sit under the sidebar');
  assert.match(bounds, /y0: mapTop\(\) \+ \d+/, 'labels can sit over the panel on a phone');
  const top = cut('function mapTop()', '\n}');
  assert.match(top, /W > 820 \? 0 : H \* 0\.\d+/,
    'mapTop no longer distinguishes the phone layout, where the panel covers the canvas');
});

it('a phone is given fewer names than a laptop', () => {
  const fn = cut('function closeUp(now, a)', '\n}');
  assert.match(fn, /\.slice\(0, W > 820 \? \d+ : \d+\)/,
    'the label cap is a single number again — nine names fit a laptop and bury a phone');
  const m = fn.match(/\.slice\(0, W > 820 \? (\d+) : (\d+)\)/);
  assert.ok(Number(m[1]) > Number(m[2]), 'the phone is given as many labels as the laptop');
  assert.ok(Number(m[1]) <= 12, `${m[1]} labels is a wall of text, which is what this replaced`);
});

console.log(`\n  ${passed} checks passed\n`);
