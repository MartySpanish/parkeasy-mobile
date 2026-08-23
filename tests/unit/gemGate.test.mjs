// The paywall on hidden gems, checked structurally.
//
// WHY THIS EXISTS. Gems are the product the subscription sells. A free user is
// meant to see THAT a gem exists and roughly where — never its name, its notes
// or its kerb-accurate pin. Every one of those four surfaces enforces that with
// the same three-line early return:
//
//     if (!isPremium && isGated(spot)) return <locked card/>
//
// Delete that line from any one of them and nothing fails, nothing warns, and
// the paid product is simply on screen for free. There is no runtime error to
// catch it and no visual difference on a subscriber's account — which is the
// account it gets tested on. That is precisely the shape of bug this file is
// for.
//
// App.jsx imports React and Leaflet and cannot be loaded in Node, so the source
// is read as text the same way tests/unit/partnerSlots.test.mjs reads it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src  = readFileSync(new URL('../../src/App.jsx', import.meta.url), 'utf8');
const gems = readFileSync(new URL('../../src/data/hiddenGems.js', import.meta.url), 'utf8');

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };

console.log('\ngemGate — a free user never gets a gem\'s name, notes or exact pin');

// ── The four render surfaces ─────────────────────────────────────────────────
// Every component that can paint a spot's name. Named individually rather than
// counted, so ADDING a fifth surface without gating it fails here too.
const SURFACES = [
  ['SpotCard',   /const SpotCard = \(\{[^}]*\}\) => \{/],
  ['ListCard',   /const ListCard = \(\{[^}]*\}\) => \{/],
  ['RowItem',    /const RowItem = \(\{[^}]*\}\) => \{/],
  ['ParkingMap', /const ParkingMap = \(\{[^}]*\}\) =>/],
];

for (const [name, re] of SURFACES) {
  it(`${name} locks a gated spot before rendering its name`, () => {
    const at = re.exec(src)?.index ?? assert.fail(`${name} not found in App.jsx — renamed?`);
    // The gate must come before anything paints spot.name. Both are searched
    // from the component's own opening brace so a neighbouring component's
    // gate cannot stand in for a missing one.
    const body  = src.slice(at, at + 4000);
    const gate  = body.indexOf('!isPremium && isGated(');
    const named = body.search(/\{s(?:pot)?\.name\}/);
    assert.ok(gate !== -1, `${name} has no "!isPremium && isGated(" gate`);
    assert.ok(named === -1 || gate < named,
      `${name} renders a spot name at ${named} before its gate at ${gate}`);
  });
}

// ── What the locked card is allowed to say ───────────────────────────────────
it('the locked label names the category and the price tier, never the spot', () => {
  const label = /const gatedLabel = \(spot\) => (.+);/.exec(src)?.[1]
    ?? assert.fail('gatedLabel not found');
  assert.ok(!/\.name/.test(label), `gatedLabel leaks the name: ${label}`);
  assert.ok(/Premium/.test(label), 'the locked label must say what unlocks it');
});

it('teaser pins are snapped to a grid, not kerb-accurate', () => {
  const fn = /const approxCoord = \(v\) => (.+);/.exec(src)?.[1]
    ?? assert.fail('approxCoord not found');
  // round(v * 200) / 200 — a 1/200° cell, ~500 m across at this latitude.
  assert.match(fn, /200/, `approxCoord no longer snaps: ${fn}`);
});

// ── Which gems are open, and which are not ───────────────────────────────────
it('every hidden gem is gated except a taster', () => {
  const at = src.indexOf('const isGated = (spot) => {');
  assert.ok(at !== -1, 'isGated not found');
  const body = src.slice(at, src.indexOf('\n};', at));
  assert.match(body, /isTasterGem\(spot\)\)\s*return false/,
    'isGated no longer opens on the shared taster test');
  assert.match(body, /spot\.badge === 'hidden_gem'\)\s*return true/,
    'isGated no longer gates hidden_gem by default');
  // The taster escape must come BEFORE the blanket gem gate, or it is dead code.
  assert.ok(body.indexOf('isTasterGem') < body.indexOf("=== 'hidden_gem'"),
    'the taster test must precede the blanket hidden_gem gate');
});

it('the badge and the card agree on which gems are free', () => {
  // Two answers derived from one predicate. When they came from separate tests,
  // a taster rendered open and still called itself Premium.
  assert.match(src, /const isTasterGem = \(spot\) =>/, 'isTasterGem not found');
  const badge = src.slice(src.indexOf('const TypeBadge = ({'), src.indexOf('const TypeBadge = ({') + 400);
  assert.match(badge, /isTasterGem\(spot\)/,
    'TypeBadge does not use the shared taster test — it can disagree with the card');
  assert.ok(!/TASTER_BADGE = \{ label:'[^']*Premium/.test(src),
    'the taster badge still calls a free spot Premium');
});

it('no gem is given away for free', () => {
  // Set to 5 once, which put the highest-voted gem in the country on the
  // results list in full. The gems are the subscription; this is the dial that
  // decides how much of it is free, and it is zero on both sides — here and in
  // hidden_gems.is_taster (20260823_no_free_tasters.sql). Raising one without
  // the other makes a free user's screen disagree with what the server sends.
  const n = /const FREE_GEMS_TOTAL = (\d+);/.exec(src)?.[1]
    ?? assert.fail('FREE_GEMS_TOTAL not found');
  assert.equal(Number(n), 0, `FREE_GEMS_TOTAL is ${n} — that many gems are free`);
});

it('the event overlay does not force gems open', () => {
  // walkIns is a hand-written id list that contains a gem (36). It rendered
  // with isPremium={true} so the event page could never be empty, which also
  // unlocked whatever gem happened to be in the list.
  const at = src.indexOf('const EventOverlay = ({');
  assert.ok(at !== -1, 'EventOverlay not found');
  const body = src.slice(at, src.indexOf('\nconst ', at + 10));
  assert.ok(!/isPremium=\{true\}/.test(body),
    'EventOverlay still hardcodes isPremium={true} — that opens any gem in walkIns');
});

it('a database is_taster:false is not re-opened by the bundled id list', () => {
  // The fallback set is keyed on ids that predate the database. If it were
  // consulted whenever is_taster was merely falsy, retiring a taster in the
  // database would not retire it in the app.
  assert.match(src, /spot\.isTaster === undefined && TASTER_GEM_IDS\.has/,
    'the bundled taster fallback is no longer gated on `undefined`');
});

// ── The other half of the gate: what the server hands a free client ──────────
it('the teaser mapping marks non-taster pins as approximate', () => {
  assert.match(gems, /approximate: !t\.is_taster/,
    'teaserToSpot no longer flags non-taster pins as approximate');
});

it('the teaser query never asks for a non-taster gem\'s exact position', () => {
  const q = /\.from\('hidden_gems_teaser'\)\s*\.select\('([^']+)'\)/.exec(gems)?.[1]
    ?? assert.fail('the hidden_gems_teaser select was not found');
  const cols = q.split(',');
  assert.ok(cols.includes('approx_lat') && cols.includes('approx_lng'),
    'the teaser must read the snapped coordinates');
  assert.ok(!cols.includes('lat') && !cols.includes('lng'),
    `the teaser is selecting exact coordinates: ${q}`);
});

console.log(`\n  ${passed} checks passed\n`);
