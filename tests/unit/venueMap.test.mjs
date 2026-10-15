// The map on an event or venue page, after its provider was retired.
//
// WHAT WAS BROKEN. Both /events/{slug} and /venue/{slug} rendered a static
// image from staticmap.openstreetmap.de with the caption "Map (c) OpenStreetMap
// contributors" under it. The OpenStreetMap wiki's StaticMapLite page marks
// that hosted service discontinued — past tense, self-host instead — and the
// OSM help answer that first recommended it said it is not a production service
// for commercial applications. So the public, indexed pages carried a broken
// image and credited a map nobody received.
//
// WHAT THESE CHECKS ARE FOR. The replacement draws from our own rows, so the
// failure modes are not network ones, they are geometry and honesty ones:
//
//   · a space due east drawn above the venue instead of beside it
//   · a dot outside the frame, silently clipped, so the scale is a lie
//   · a direction stated for a space too close for the sector to be stable
//   · the numbers on the diagram not matching the numbers in the list
//   · Number(null) === 0 reading as "too close to say" instead of "unknown"
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  offsetM, bearingWord, DIRECTION_MIN_M, COMPASS, RINGS, ringFor, ringLabel,
  plotted, atVenue, numberList, mapAltText, venueMap,
} from '../../api/_venueMap.js';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };

console.log('\nvenueMap — the page stopped crediting a map it never got');

// Ulster Hall, Belfast.
const VENUE = { name: 'Ulster Hall', venue_name: 'Ulster Hall', lat: 54.5934, lng: -5.9345 };

/** A listing `m` metres from the venue on the given true bearing. */
const at = (bearingDeg, m, extra = {}) => {
  const rad = bearingDeg * Math.PI / 180;
  const n = Math.cos(rad) * m, e = Math.sin(rad) * m;
  return {
    title: extra.title || `Space ${bearingDeg}`,
    lat: VENUE.lat + n / 111320,
    lng: VENUE.lng + e / (111320 * Math.cos(VENUE.lat * Math.PI / 180)),
    d: m,
    ...extra,
  };
};

// ── 1. The projection is the right way up and the right way round ────────────
it('east is to the right and north is up, not the other way about', () => {
  // THE DEFECT THIS CATCHES. SVG's y axis grows DOWNWARD, so a north offset has
  // to be negated. Forget it and every diagram is mirrored vertically: a space
  // north of the venue is drawn to the south of it, and the page is confidently
  // pointing drivers the wrong way.
  const [east] = plotted(VENUE, [at(90, 400)]);
  const [north] = plotted(VENUE, [at(0, 400)]);
  const [south] = plotted(VENUE, [at(180, 400)]);
  const [west] = plotted(VENUE, [at(270, 400)]);

  assert.ok(east.x > 200, `a space due east was drawn at x=${east.x}, left of centre`);
  assert.ok(Math.abs(east.y - 200) < 2, `a space due east drifted to y=${east.y}`);
  assert.ok(north.y < 200, `a space due north was drawn at y=${north.y} — BELOW the venue`);
  assert.ok(south.y > 200, `a space due south was drawn at y=${south.y} — ABOVE the venue`);
  assert.ok(west.x < 200, `a space due west was drawn at x=${west.x}, right of centre`);
});

it('the compass word matches the bearing it was built from', () => {
  for (const [deg, word] of [
    [0, 'north'], [45, 'north-east'], [90, 'east'], [135, 'south-east'],
    [180, 'south'], [225, 'south-west'], [270, 'west'], [315, 'north-west'],
    [360, 'north'],
  ]) {
    const [p] = plotted(VENUE, [at(deg, 600)]);
    assert.equal(p.direction, word, `a bearing of ${deg}deg was called ${p.direction}`);
  }
  assert.equal(COMPASS.length, 8, 'the compass is no longer 8-point — the sector maths assumes it');
});

it('longitude is scaled by cos(latitude), so east is not stretched', () => {
  // A degree of longitude at 54.6N is about 58% of a degree of latitude. Drop
  // the cosine and every east-west offset is overstated by ~72%, which pushes
  // dots outside the ring and misstates which sector they are in.
  const o = offsetM(VENUE.lat, VENUE.lng, VENUE.lat, VENUE.lng + 1);
  assert.ok(Math.abs(o.e - 111320 * Math.cos(VENUE.lat * Math.PI / 180)) < 1,
    `one degree of longitude came out as ${o.e}m`);
  const north = offsetM(VENUE.lat, VENUE.lng, VENUE.lat + 1, VENUE.lng);
  assert.ok(north.n > o.e, 'a degree of longitude was not shorter than a degree of latitude');
});

it('the projection agrees with the haversine distance the page prints, to 0.2%', () => {
  // The panel's distances come from the haversine helper in api/events.js. If
  // this projection disagreed with it, a space labelled "about 400m away" would
  // be drawn at a radius the label does not match.
  //
  // THE BOUND IS MEASURED, NOT GUESSED, AND IT IS NOT ZERO. Swept over every
  // bearing out to 2km the worst case is 2.4m — 0.12%, which is 0.18 of a
  // pixel on the 150px ring. The first version of this check asserted "within
  // 1m" to match a comment that claimed centimetres; both the comment and the
  // threshold were wrong, and the real figure is in api/_venueMap.js now.
  // 0.2% is tight enough that dropping the cosine on the longitude term (~72%
  // at this latitude) or swapping the metres-per-degree constant cannot pass.
  const R = 6371000;
  const metres = (aLat, aLng, bLat, bLng) => {
    const p = Math.PI / 180;
    const dLat = (bLat - aLat) * p, dLng = (bLng - aLng) * p;
    const h = Math.sin(dLat / 2) ** 2
            + Math.cos(aLat * p) * Math.cos(bLat * p) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  };
  let worst = 0;
  for (let deg = 0; deg < 360; deg += 15) {
    for (const m of [120, 500, 1200, 2000]) {
      const l = at(deg, m);
      const o = offsetM(VENUE.lat, VENUE.lng, l.lat, l.lng);
      const flat = Math.hypot(o.e, o.n);
      const hav = metres(VENUE.lat, VENUE.lng, l.lat, l.lng);
      const rel = Math.abs(flat - hav) / hav;
      worst = Math.max(worst, rel);
      assert.ok(rel < 0.002,
        `at ${deg}deg/${m}m the projection is out by ${(rel * 100).toFixed(3)}% `
        + `(${flat.toFixed(2)}m vs ${hav.toFixed(2)}m)`);
    }
  }
  // And it must not be trivially passing because the sweep found nothing.
  assert.ok(worst > 0, 'the projection matched haversine exactly — is the sweep running?');
});

// ── 2. Nothing is drawn outside the frame ────────────────────────────────────
it('the ring is the smallest round number everything fits inside', () => {
  assert.deepEqual(RINGS, [250, 500, 750, 1000, 1500, 2000],
    'the ring ladder changed — check the labels still read as round numbers');
  assert.equal(ringFor(100), 250);
  assert.equal(ringFor(250), 250, 'a space exactly on the ring was pushed to the next one');
  assert.equal(ringFor(251), 500);
  assert.equal(ringFor(1999), 2000);
  // WHY THE LADDER IS FINER THAN 250/500/1000/2000. A furthest space of 1120m
  // fell to the 2km ring on the coarse ladder, which put it at 84 of 150
  // pixels and squashed everything nearer into the middle.
  assert.equal(ringFor(1120), 1500, 'a 1120m set is back on the wasteful 2km ring');
  assert.ok(RINGS.every((r, i) => i === 0 || r > RINGS[i - 1]), 'the ladder is not ascending');
  // nearbyListings caps at 2km, but a bigger number must still land inside.
  assert.equal(ringFor(99999), 2000, 'an out-of-range distance produced no ring');
  // Number(null) is 0 — finite, not negative, and would pick the smallest ring
  // for data we do not have. Same trap as distanceLabel() and median().
  for (const bad of [null, undefined, '', NaN, 0, -5, 'x']) {
    assert.equal(ringFor(bad), 500, `ringFor(${JSON.stringify(bad)}) did not fall back`);
  }
});

it('every dot lands inside the ring, whatever the distances say', () => {
  // THE DEFECT. A dot drawn outside the circle is clipped by the viewBox and
  // reads as "roughly on the ring", which is a scale that lies. Here the `d`
  // values disagree with the coordinates — a stale row, or a listing moved —
  // and the clamp is the only thing holding the frame.
  // `d` is above the direction floor so these DO get dots, but it disagrees
  // wildly with the coordinates — a stale row, or a listing that moved — and
  // the clamp is the only thing holding the frame.
  const liars = [at(10, 4000, { d: 200 }), at(200, 9000, { d: 300 })];
  const drawn = plotted(VENUE, liars);
  assert.equal(drawn.length, 2, 'the clamp case never got plotted — the test proves nothing');
  for (const p of drawn) {
    const r = Math.hypot(p.x - 200, p.y - 200);
    assert.ok(r <= 150 + 0.01, `a dot was drawn ${r.toFixed(1)}px out, past the 150px ring`);
  }
  // And the honest case is NOT clamped — it has to sit at its true radius.
  const [half] = plotted(VENUE, [at(0, 250)]);
  const r = Math.hypot(half.x - 200, half.y - 200);
  assert.ok(Math.abs(r - 150) < 1,
    `a space at the ring distance was drawn at ${r.toFixed(1)}px instead of 150px`);
});

it('the radius is proportional to the distance', () => {
  // One ring for the set, so 250m in a 500m ring is half way out. Mutating the
  // scale to a constant would still keep every dot inside the frame.
  // All three are above the direction floor, or they would not be plotted at
  // all and this would pass on an empty array.
  const pts = plotted(VENUE, [at(0, 500), at(0, 250), at(0, 160)]);
  assert.equal(pts.length, 3, `${pts.length} of 3 spaces were plotted`);
  const radii = pts.map(p => Math.hypot(p.x - 200, p.y - 200));
  assert.ok(Math.abs(radii[0] - 150) < 1, `500m of a 500m ring drew at ${radii[0].toFixed(1)}px`);
  assert.ok(Math.abs(radii[1] - 75) < 1, `250m of a 500m ring drew at ${radii[1].toFixed(1)}px`);
  assert.ok(Math.abs(radii[2] - 48) < 1, `160m of a 500m ring drew at ${radii[2].toFixed(1)}px`);
  assert.equal(new Set(pts.map(p => p.ring)).size, 1, 'the dots were scaled to different rings');
});

// ── 3. A direction is only stated when it is stable ──────────────────────────
it('no direction is claimed for a space too close for the sector to hold', () => {
  // THE HONESTY RULE. A 45deg sector at 80m is about 60m wide, which is inside
  // the error of an unsurveyed pin: the page would say "north-east" of
  // something that is actually east. distanceLabel() makes the same call by
  // saying "under 100m away" instead of a figure.
  assert.equal(DIRECTION_MIN_M, 150, 'the direction floor moved — is the sector still stable?');
  for (const m of [0, 1, 50, 149]) {
    const l = at(45, Math.max(m, 1), { d: m });
    // AND IT GETS NO DOT. The first version refused to write "north-east" in
    // words and then drew the dot at north-east anyway, so the picture made
    // the claim the prose had just declined to make.
    assert.deepEqual(plotted(VENUE, [l]), [],
      `a space ${m}m away was given a position on the diagram`);
    assert.deepEqual(atVenue(VENUE, [l]).map(p => p.n), [1],
      `a space ${m}m away was dropped instead of being named at the venue`);
  }
  const [ok] = plotted(VENUE, [at(45, 150, { d: 150 })]);
  assert.equal(ok.direction, 'north-east', 'a space exactly at the floor lost its direction');
  assert.deepEqual(atVenue(VENUE, [at(45, 150, { d: 150 })]), [],
    'a space at the floor was ALSO listed as being at the venue');
});

it('a space is in exactly one of the two groups, and keeps its panel number', () => {
  // The caption names the at-venue ones by number and the dots carry the
  // others, so a space appearing in both would be counted twice and a space in
  // neither would vanish from the page.
  const ls = [at(0, 1200), at(90, 80, { d: 80 }), at(180, 400), at(270, 40, { d: 40 })];
  const dots = plotted(VENUE, ls).map(p => p.n);
  const nears = atVenue(VENUE, ls).map(p => p.n);
  assert.deepEqual(dots, [1, 3], 'the plotted numbers are not the panel indices');
  assert.deepEqual(nears, [2, 4], 'the at-venue numbers are not the panel indices');
  assert.deepEqual([...dots, ...nears].sort((a, b) => a - b), [1, 2, 3, 4],
    'a space is in both groups or in neither');
});

it('the caption names the spaces the drawing deliberately has no dot for', () => {
  // Otherwise they are simply missing from the graphic, and the numbering in
  // the panel beneath has gaps nobody can explain.
  const one = venueMap(VENUE, [at(0, 900), at(90, 60, { d: 60 })]);
  assert.match(one, /Space 2\s+is at Ulster Hall itself/,
    'a single at-venue space is not named in the caption');
  const two = venueMap(VENUE, [at(0, 900), at(90, 60, { d: 60 }), at(180, 30, { d: 30 })]);
  assert.match(two, /Spaces 2 and 3\s+are at Ulster Hall itself/,
    'two at-venue spaces are not named, or not pluralised');
  assert.ok(!/at Ulster Hall itself/.test(venueMap(VENUE, [at(0, 900)])),
    'the at-venue line appeared with nothing to put in it');
  assert.equal(numberList([4]), '4');
  assert.equal(numberList([2, 3]), '2 and 3');
  assert.equal(numberList([1, 2, 5]), '1, 2 and 5');
});

it('a missing distance is unknown, not close', () => {
  // Number(null) is 0, which is finite and below the floor — so a null `d`
  // would reach the same `return null` as "too close to say". It must get
  // there because the value is MISSING, which is why the null test comes
  // first and is asserted separately. Third occurrence of this trap in the
  // codebase, after distanceLabel() and median().
  for (const d of [null, undefined, '', NaN, 'x']) {
    assert.equal(bearingWord(300, 300, d), null, `bearingWord with d=${JSON.stringify(d)} spoke`);
  }
  // A real distance with broken coordinates must also stay quiet.
  assert.equal(bearingWord(null, null, 900), null);
  assert.equal(bearingWord(0, 0, 900), null, 'a zero offset produced a direction');
  assert.equal(bearingWord(300, 300, 900), 'north-east');
});

// ── 4. The diagram and the list are the same thing ───────────────────────────
it('the numbers on the diagram are the list order', () => {
  // THE DEFECT THIS CATCHES. The diagram is only useful if dot 2 is row 2.
  // nearbyListings() sorts by distance, so the index is the order the panel
  // renders — not a re-sort by bearing, and not 0-based.
  const ls = [at(0, 200), at(90, 400), at(180, 900)];
  const pts = plotted(VENUE, ls);
  assert.deepEqual(pts.map(p => p.n), [1, 2, 3], 'the numbering is not the list order');
  assert.deepEqual(pts.map(p => p.title), ls.map(l => l.title), 'the titles were reordered');
});

it('a listing with no coordinates is dropped, not drawn at the venue', () => {
  // 0,0 is the Gulf of Guinea; null coerces to it. A space with no position
  // must not be drawn on top of the venue marker as if it were next door.
  const pts = plotted(VENUE, [
    at(90, 400),
    { title: 'No position', lat: null, lng: null, d: 300 },
    { title: 'Junk', lat: 'x', lng: 'y', d: 300 },
    at(180, 500),
  ]);
  assert.equal(pts.length, 2, `${pts.length} dots were drawn from 2 usable rows`);
  assert.deepEqual(pts.map(p => p.title), ['Space 90', 'Space 180']);
});

it('no venue coordinates means no diagram at all', () => {
  for (const v of [{}, { lat: null, lng: null }, { lat: 'x', lng: 1 }, null]) {
    assert.deepEqual(plotted(v, [at(90, 400)]), [], 'dots were plotted around nothing');
    assert.equal(venueMap(v, [at(90, 400)]), '',
      'a diagram was rendered for a venue with no position');
  }
});

// ── 5. The markup ────────────────────────────────────────────────────────────
it('the SVG is labelled in words, for a screen reader and for Google', () => {
  const html = venueMap(VENUE, [at(45, 400), at(180, 1200)]);
  assert.match(html, /role="img"/, 'the SVG is not announced as an image');
  assert.match(html, /aria-label="[^"]+"/, 'the SVG carries no description');
  const ls2 = [at(45, 400), at(180, 1200)];
  const alt = mapAltText(VENUE, plotted(VENUE, ls2), atVenue(VENUE, ls2));
  assert.match(alt, /Ulster Hall/, 'the description does not name the venue');
  assert.match(alt, /north-east/, 'the description does not say where anything is');
  assert.match(alt, /2 bookable spaces/, 'the description does not say how many');
  // The decorative innards must not be announced separately on top of it.
  assert.match(html, /aria-hidden="true"/, 'the drawing is announced twice');
});

it('the caption says what the diagram is and is not', () => {
  // The old caption credited OpenStreetMap for an image that never arrived.
  // This one must not claim to be a street map, because it is not one.
  const html = venueMap(VENUE, [at(45, 400)]);
  assert.match(html, /not a street map/, 'the caption does not say what this is not');
  assert.match(html, /Numbers match the list/, 'nothing ties the dots to the panel');
  assert.ok(!/OpenStreetMap/.test(html),
    'OpenStreetMap is still credited for imagery that is not there');
  assert.ok(!/staticmap/.test(html), 'the retired provider is still referenced');
});

it('the ring labels are the distances the rings mean', () => {
  assert.equal(ringLabel(250), '250m');
  assert.equal(ringLabel(500), '500m');
  assert.equal(ringLabel(750), '750m');
  assert.equal(ringLabel(1000), '1.0km');
  assert.equal(ringLabel(1500), '1.5km');
  assert.equal(ringLabel(2000), '2.0km');
  // A 1200m set gets the 1.5km ring, so the drawing must say 1.5km and 750m —
  // the half ring is half the OUTER ring, not half the furthest space.
  const html = venueMap(VENUE, [at(0, 1200)]);
  assert.match(html, />1\.5km</, 'the outer ring is not labelled with its own distance');
  assert.match(html, />750m</, 'the half ring is not labelled');
  assert.ok(!/>600m</.test(html), 'the half ring was labelled from the furthest space');
});

it('a venue name with HTML in it cannot break out', () => {
  const nasty = { name: '<script>x</script>"&', venue_name: '<script>x</script>"&', lat: 54.6, lng: -5.9 };
  const html = venueMap(nasty, [at(45, 400)]);
  assert.ok(!html.includes('<script>'), 'a venue name closed out of its attribute');
  assert.match(html, /&lt;script&gt;/, 'the name was not escaped');
});

it('the venue marker is painted after the dots, so it is never buried', () => {
  // A space just over the direction floor in a 2km ring sits ~11px from the
  // centre, which is inside the venue marker. Whichever is drawn second wins,
  // and the one thing the diagram cannot lose is where the venue is.
  const html = venueMap(VENUE, [at(0, 160, { d: 160 }), at(90, 2000)]);
  const lastDot = html.lastIndexOf('fill="#2ED3C6"');
  const marker = html.indexOf('fill="#EAF1F8"');
  assert.ok(lastDot !== -1 && marker !== -1, 'the dots or the venue marker are gone');
  assert.ok(marker > lastDot,
    'the venue marker is drawn before the dots — a near space will cover it');
});

it('a venue with no bookable spaces still gets a frame, not a broken one', () => {
  // The panel beneath says "we are recruiting hosts near here". An empty ring
  // with the venue in it is still orienting; what it must not do is promise
  // numbers that are not there.
  const html = venueMap(VENUE, []);
  assert.ok(html.length > 0, 'a venue with no spaces lost its diagram');
  assert.ok(!/Numbers match the list/.test(html), 'it promised numbers with no dots');
  assert.match(html, /measured from Ulster Hall/, 'it does not say what the ring is around');
  assert.match(html, />500m</, 'an empty diagram has no scale');
});

// ── 6. The wiring, and the dead host ─────────────────────────────────────────
it('no page fetches a map from the retired host any more', () => {
  const events = read('../../api/events.js');
  assert.ok(!/staticmap\.openstreetmap\.de/.test(events),
    'api/events.js still requests the discontinued static map service');
  assert.ok(!/function staticMap\b/.test(events), 'the old staticMap renderer is still here');
  // Both page types must use the replacement. Two call sites, because an event
  // page and a venue page are rendered separately.
  const calls = events.match(/venueMap\(/g) || [];
  assert.ok(calls.length >= 3, `venueMap is referenced ${calls.length} times — import + 2 pages`);
  assert.match(events, /\$\{ev\.lat != null \? venueMap\(ev, listings\) : ''\}/,
    'the event page does not render the diagram');
  assert.match(events, /\$\{v\.lat != null \? venueMap\(place, listings\) : ''\}/,
    'the venue page does not render the diagram');
});

it('the retired host is out of the CSP, and the live ones are still in', () => {
  // Leaving a dead origin in img-src is not dangerous, it is just a lie about
  // what the page loads. Both copies have to agree: the meta tag serves
  // GitHub Pages, the header serves Vercel.
  for (const f of ['../../index.html', '../../vercel.json']) {
    const src = read(f);
    assert.ok(!/staticmap\.openstreetmap\.de/.test(src),
      `${f} still allows the discontinued static map host`);
    assert.match(src, /img-src[^;]*https:\/\/maps\.googleapis\.com/,
      `${f} dropped maps.googleapis.com from img-src — Street View cannot draw`);
    assert.match(src, /img-src[^;]*https:\/\/tile\.openstreetmap\.org/,
      `${f} dropped the OSM tile host — the basemap fallback cannot draw`);
  }
});

it('both panels are rendered by one function, so they cannot drift', () => {
  const events = read('../../api/events.js');
  const panels = events.match(/listingPanel\(/g) || [];
  assert.equal(panels.length, 3, `listingPanel appears ${panels.length} times — 1 definition + 2 uses`);
  // The number badge in the panel is what the diagram's numbering refers to.
  assert.match(events, /\$\{i \+ 1\}/, 'the panel rows are not numbered');
  assert.match(events, /bearingWord\(o\.e, o\.n, l\.d\)/,
    'the panel rows no longer state a direction');
});

console.log(`\n  ${passed} checks passed\n`);
