// The two strategy overlays on /globe, and the things about them that are
// claims rather than decoration.
//
// WHAT THESE LAYERS ARE. Static founder-supplied reference data: 18 target
// cities with a tier and a pain-point stat, and 5 car park operators shown at
// their HEAD OFFICE. Neither is a measurement taken from ParkEasy and neither
// is site-level. That distinction is the whole risk here — this page's other
// markers mean "you can park here", and 744 of them are true. A building icon
// over Stuttgart that reads as a car park would be the same class of lie as a
// wrong restriction on a bay, so the shape, the wording and the tier colours
// are all load-bearing and all checked.
//
// The globe is one inline <script> in a plain HTML file and cannot be
// imported, so structure is checked as source text — but the tier logic and
// the data are pulled out and actually EXECUTED, because a regex that matches
// a colour is not the same as a colour reaching the right city.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../../public/globe/index.html', import.meta.url), 'utf8');
const markets = JSON.parse(
  readFileSync(new URL('../../public/globe/markets.json', import.meta.url), 'utf8'));

// Lift the real TIERS table and tierOf() out of the page and run them, rather
// than asserting against a copy that could drift.
const lift = (name, re) => {
  const m = html.match(re);
  assert.ok(m, `${name} is gone from the globe page`);
  return m[1];
};
const TIERS = new Function('return ' + lift('TIERS', /const TIERS = (\{[\s\S]*?\n\});/))();
const tierOf = new Function('TIERS', 'return ' + lift('tierOf', /const (tierOf = h => TIERS\[h\.tier\] \|\| TIERS\[1\]);/).replace(/^tierOf = /, ''))(TIERS);

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };

console.log('\nglobeMarkets — the overlay says what it is');

//------------------------------------------------------------------ the data
it('the data is all there and plots where it claims to', () => {
  assert.equal(markets.hotspots.length, 18, 'a target market has gone missing');
  assert.equal(markets.operators.length, 5, 'an operator has gone missing');
  for (const p of [...markets.hotspots, ...markets.operators]) {
    const who = p.city || p.operator;
    assert.ok(Number.isFinite(p.lat) && Math.abs(p.lat) <= 90, `${who}: bad latitude`);
    assert.ok(Number.isFinite(p.lng) && Math.abs(p.lng) <= 180, `${who}: bad longitude`);
  }
  // Belfast is the one market that actually exists, and the page's whole
  // premise. It is also the only 'home' tier.
  const home = markets.hotspots.filter(h => h.tier === 'home');
  assert.equal(home.length, 1, 'there is not exactly one home market');
  assert.equal(home[0].city, 'Belfast', 'the home market is not Belfast');
});

it('every city gets the tier it was given, not a silent default', () => {
  // tierOf() falls back to tier 1 for anything it does not recognise. That
  // fallback is correct for robustness and DANGEROUS for data: a city typed as
  // tier "2 " or "two" would quietly paint blue and be read as a near-term
  // target. So every tier in the file must be one the table actually knows.
  for (const h of markets.hotspots) {
    assert.ok(Object.prototype.hasOwnProperty.call(TIERS, h.tier),
      `${h.city}: tier ${JSON.stringify(h.tier)} is not in the tier table, so it would draw as tier 1`);
  }
  // And the mapping genuinely lands where it should.
  assert.equal(tierOf({ tier: 'home' }).colour, TIERS.home.colour);
  assert.equal(tierOf(markets.hotspots.find(h => h.city === 'London')).colour, TIERS[2].colour,
    'London is not amber — it is the entrenched-competitor tier');
  assert.equal(tierOf(markets.hotspots.find(h => h.city === 'Toronto')).colour, TIERS[1].colour,
    'Toronto is not blue — it is a near-term candidate');
});

it('the three tiers are told apart by colour', () => {
  // Colour IS the encoding here; two tiers sharing one would erase the
  // distinction the layer exists to draw.
  const cols = [TIERS.home.colour, TIERS[1].colour, TIERS[2].colour];
  assert.equal(new Set(cols).size, 3, 'two tiers share a colour');
  for (const c of cols) assert.match(c, /^#[0-9A-Fa-f]{6}$/, `${c} is not a hex colour`);
});

//------------------------------------------------------- operators ≠ parking
it('an operator head office is not drawn as a place you can park', () => {
  // The building block, drawn with fillRect, against the arc() every parking
  // marker uses. If operators ever draw as a circle they join the vocabulary
  // that means "park here".
  const fn = html.slice(html.indexOf('function drawMarkets'), html.indexOf('function paintTip'));
  assert.ok(fn.length > 300, 'drawMarkets is gone');
  const op = fn.slice(fn.indexOf('} else {'));
  assert.match(op, /fillRect/, 'the operator marker is no longer a building');
  assert.ok(!/arc\(/.test(op), 'the operator marker is drawn as a circle, which on this map means parking');
});

it('the operator tooltip says head office, and counts countries not car parks', () => {
  const fn = html.slice(html.indexOf('function tipHTML'), html.indexOf('function setTip'));
  assert.ok(fn.length > 200, 'tipHTML is gone');
  assert.match(fn, /Head office/, 'the tooltip no longer says these are head offices');
  assert.match(fn, /Operates in ' \+ o\.countries_active/,
    'the operator tooltip no longer reports countries_active');
  // Singular/plural, because "Operates in 1 countries" is the sort of thing
  // that makes a reader doubt the rest of the number.
  assert.match(fn, /countries_active === 1 \? 'y' : 'ies'/, 'the country count is not pluralised');
});

//-------------------------------------------------------------- the tooltip
it('the tooltip carries city, country and the stat', () => {
  const fn = html.slice(html.indexOf('function tipHTML'), html.indexOf('function setTip'));
  assert.match(fn, /esc\(h\.city\)/, 'the city is gone from the tooltip');
  assert.match(fn, /esc\(h\.country\)/, 'the country is gone from the tooltip');
  assert.match(fn, /esc\(h\.stat\)/, 'the pain-point stat is gone from the tooltip');
});

it('data reaching innerHTML is escaped', () => {
  // Static today. The rule has to hold anyway, or it stops holding the day
  // somebody points this at a feed.
  const fn = html.slice(html.indexOf('function tipHTML'), html.indexOf('function setTip'));
  const interpolations = fn.match(/\+ (?:esc\()?[ho]\.\w+/g) || [];
  assert.ok(interpolations.length >= 6, 'the tooltip stopped interpolating data');
  const raw = interpolations.filter(s => !s.includes('esc(') && !/countries_active/.test(s));
  assert.deepEqual(raw, [], `unescaped values reach innerHTML: ${raw.join(', ')}`);
});

//---------------------------------------------------------------- behaviour
it('the two layers toggle independently of each other', () => {
  assert.match(html, /const layerOn = \{ hotspots: true, operators: true \}/,
    'the layers no longer have their own switches');
  const fn = html.slice(html.indexOf('function buildLayerToggles'), html.indexOf('function marker('));
  assert.ok(fn.length > 200, 'buildLayerToggles is gone');
  // One key flips, not both — a shared flag would make them one layer.
  assert.match(fn, /layerOn\[k\] = !layerOn\[k\]/, 'toggling no longer flips just the layer clicked');
  assert.match(fn, /aria-pressed/, 'the toggle state is not exposed to assistive tech');
});

it('a marker on the far side of the globe is not painted on the near side', () => {
  // d3's orthographic projection returns coordinates for points round the
  // back. Without this guard Sydney draws on top of Spain — and, worse, is
  // CLICKABLE there.
  assert.match(html, /function facing\(c\)[\s\S]{0,220}?geoDistance/,
    'the far-side guard is gone');
  const draw = html.slice(html.indexOf('function drawMarkets'), html.indexOf('function paintTip'));
  assert.match(draw, /if \(!facing\(m\.c\)\) return;/, 'drawMarkets paints markers round the back');
  const hit = html.slice(html.indexOf('function marketAt'), html.indexOf('function hitAt'));
  assert.match(hit, /if \(!facing\(m\.c\)\) return;/, 'a marker round the back is still clickable');
});

it('an open marker stops the globe turning under it', () => {
  const fn = html.slice(html.indexOf("} else if (mode === 'globe')"), html.indexOf('projection.rotate('));
  assert.match(fn, /if \(!pinned\) spin \+=/, 'the globe spins while a tooltip is pinned open');
});

it('the overlay fades out before the map becomes Northern Ireland', () => {
  // These are world markers. Left on during the dive they would sit over NI
  // towns, where a building icon reads as a car park.
  assert.match(html, /if \(zoom < 0\.55\) drawMarkets\(now, 1 - zoom \/ 0\.55\)/,
    'the overlay no longer fades out as the camera dives');
});

//------------------------------------------------------------- not yet live
it('nothing here is wired to a live source', () => {
  // Explicitly asked for: this is a static reference layer until Marty says
  // otherwise. Site-level operator data would have to come from Google Places
  // or a licensed feed, never from guesses typed into this file.
  assert.match(html, /d3\.json\('\/globe\/markets\.json'\)\.catch\(\(\) => null\)/,
    'markets.json is no longer loaded, or a failure to load is now fatal');
  const load = html.slice(html.indexOf("d3.json('/globe/markets.json')"), html.length);
  assert.ok(!/googleapis|places\.googleapis|\/api\//.test(load.slice(0, 400)),
    'the overlay now calls a live API — that needed asking first');
  assert.match(markets.note, /STATIC REFERENCE DATA/,
    'the file no longer states what it is, so the next reader will assume it is measured');
});

console.log(`\n  ${passed} checks passed\n`);
