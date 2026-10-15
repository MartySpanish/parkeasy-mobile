// What we may tell a campervan driver, and the one thing we must never tell them.
//
// THE STAKES ARE DIFFERENT HERE. Everywhere else in this app a wrong answer
// costs a wasted journey. Here it costs a van stuck at a 1.9m height bar with a
// queue behind it, or a 3am knock on the window, or a £100 notice. So this file
// adds no locations and the classifier guesses nothing: it reads what the
// existing 787 spots already say about themselves.
//
// WHAT THE DATA SUPPORTS, verified against the real dataset at the bottom:
//   2   designated motorhome facilities, already present and unfindable
//   1   spot with a 2.6–3.2m barrier (depends on the van)
//   18  spots a campervan physically cannot use
//   4   explicit overnight bans
//   766 spots that say nothing, and get no line
//
// THE FOUR WAYS THIS GOES WRONG, every one of them a safety problem rather than
// a cosmetic one:
//   1. A LABEL BEATING A BARRIER. A row that calls itself an aire and also
//      names a 2m barrier must come out 'no'. Physics is not negotiable.
//   2. A TYPO READ AS A FACT. Ocean Terminal's row contains BOTH "2.10m height
//      limit" and a mis-typed "10m height limit". A parser that takes the
//      second reports a multi-storey as campervan-friendly.
//   3. A PRIVATE SITE READ AS A RECOMMENDATION. Keel Beach's notes mention a
//      Caravan & Camping Park only to say it is patrons-only. Matching on notes
//      turns that warning into an invitation.
//   4. IMPLYING PERMISSION TO SLEEP. Nothing in this dataset is a permission to
//      stay overnight. `overnight` is therefore NEVER 'yes'.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadAllSpots } from '../../scripts/lib/loadSpots.mjs';
import {
  classifyCampervan, barrierHeightM, isCampervanSpot, isCampervanCandidate,
  hasCampervanWarning, BARRIER_MIN_M, BARRIER_MAX_M, CAMPERVAN_MIN_M, CAMPERVAN_MAX_M,
} from '../../src/data/campervan.js';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const app = read('../../src/App.jsx');
const appCode = app.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };

console.log('\ncampervan — derived from the data, never guessed');

const spot = (over = {}) => ({ name: 'A Car Park', near: '', notes: '', restriction: '', ...over });

// ── 1. Physics beats the label ───────────────────────────────────────────────
it('a 2m barrier overrides a spot calling itself a motorhome aire', () => {
  // THE WORST FAILURE AVAILABLE: sending a motorhome to a height bar because
  // the sign over the door said "Aire".
  const c = classifyCampervan(spot({ name: 'Harbour Motorhome Aire', notes: '2m height barrier at the entrance' }));
  assert.equal(c.fits, 'no', 'a label raised a barrier');
  assert.equal(c.heightM, 2);
  // And an explicit exclusion beats it too.
  assert.equal(classifyCampervan(spot({ name: 'Motorhome Area', notes: 'no campervans' })).fits, 'no');
});

it('the height bands are the two named constants, and nothing else', () => {
  assert.equal(CAMPERVAN_MIN_M, 2.6);
  assert.equal(CAMPERVAN_MAX_M, 3.2);
  const at = (h) => classifyCampervan(spot({ notes: `${h}m height barrier` })).fits;
  assert.equal(at(1.9), 'no');
  assert.equal(at(2.5), 'no');
  assert.equal(at(2.59), 'no');
  assert.equal(at(2.6), 'tight', 'the bottom of the band is not inclusive');
  assert.equal(at(3.0), 'tight');
  assert.equal(at(3.2), 'tight', 'the top of the band is not inclusive');
  assert.equal(at(3.21), 'unknown', 'a barrier taller than any campervan still objected');
  assert.equal(at(4.0), 'unknown');
});

// ── 2. A typo must not become a fact ─────────────────────────────────────────
it('an implausible height is ignored, and the LOWEST plausible one wins', () => {
  // Ocean Terminal's real row, which contains both figures.
  const real = spot({ name: 'Ocean Terminal Car Park', notes: '10m height limit; no overnight/long-term parking. 2.10m height limit on the ramp.' });
  assert.equal(barrierHeightM(real), 2.10, 'the mis-typed 10m was read as the barrier');
  assert.equal(classifyCampervan(real).fits, 'no');
  // Outside the plausible range entirely → no height known at all.
  assert.equal(barrierHeightM(spot({ notes: '10m height limit' })), null);
  assert.equal(barrierHeightM(spot({ notes: '0.4m height limit' })), null);
  assert.equal(BARRIER_MIN_M, 1.5);
  assert.equal(BARRIER_MAX_M, 4.5);
  // Both word orders, because the dataset is hand-written and has both.
  assert.equal(barrierHeightM(spot({ notes: '2.1m height limit' })), 2.1);
  assert.equal(barrierHeightM(spot({ notes: 'height limit approx 1.9m' })), 1.9);
  assert.equal(barrierHeightM(spot({ notes: 'height barrier of 3m' })), 3);
  // A metre figure that is not about height is not a barrier.
  assert.equal(barrierHeightM(spot({ notes: '200m from the beach, 50m walk' })), null);

  // TWO PLAUSIBLE HEIGHTS: the LOWER one is the one the van has to get under.
  // This is what makes Math.min load-bearing. The Ocean Terminal fixture above
  // does not, because the plausible range already rejects its mis-typed 10m —
  // so a mutation to Math.max survived until this case existed.
  assert.equal(barrierHeightM(spot({ notes: '3m height barrier at the entrance, 2.1m height limit on the lower deck' })),
    2.1, 'the higher of two real barriers was reported — a van would hit the lower one');
  assert.equal(classifyCampervan(spot({ notes: '3m height barrier at the entrance, 2.1m height limit on the lower deck' })).fits,
    'no');

  // A PLAUSIBLE FIGURE THAT IS NOT A HEIGHT, far from the word "height".
  // The match window is deliberately narrow (40 chars). Widen it and the bay
  // WIDTH below gets read as a barrier — and because it is lower than the real
  // barrier, Math.min then makes it the answer, turning a usable 3m entrance
  // into "not suitable". Neither guard catches this alone.
  // ONE SENTENCE, no full stop between the two figures. The match window is
  // `[^.·]{0,40}?` and the character class already refuses to cross a sentence
  // boundary — so a fixture with a full stop in the middle proves nothing about
  // the LENGTH, and a mutation widening it to 400 survived that version.
  const wideBays = spot({
    notes: 'The bays are 2m wide with clear markings and the entrance has a 3m height barrier',
  });
  assert.equal(barrierHeightM(wideBays), 3,
    'a bay width far from the word "height" was read as the height barrier');
  assert.equal(classifyCampervan(wideBays).fits, 'tight');
});

// ── 3. A private site is not a recommendation ────────────────────────────────
it('a caravan park named in the NOTES never makes a spot campervan-friendly', () => {
  // Keel Beach's real note says the adjacent caravan park is patrons-only.
  const keel = spot({
    name: 'Keel Beach (Sandybanks) car park',
    notes: 'Free all day — use the public beach car park only; the adjacent Keel Sandybanks Caravan & Camping Park is private (patrons only)',
  });
  assert.equal(classifyCampervan(keel).fits, 'unknown',
    'a private caravan park in the notes was read as a campervan facility');
  assert.equal(isCampervanSpot(keel), false);
  // A caravan or holiday park is somebody's campsite, not a car park — not even
  // when it is the name.
  assert.equal(classifyCampervan(spot({ name: 'Jordanstown Loughshore / Caravan Park' })).fits, 'unknown');
  assert.equal(classifyCampervan(spot({ name: 'Golflinks Hotel & Holiday Park' })).fits, 'unknown');
  // The designation must come from the name, and only for a motorhome/aire.
  assert.equal(classifyCampervan(spot({ name: 'Harbour Car Park (Motorhome Aire)' })).fits, 'yes');
  assert.equal(classifyCampervan(spot({ name: 'Sandhill Drive Motorhome & Overflow Area' })).fits, 'yes');
  assert.equal(classifyCampervan(spot({ name: 'A Car Park', notes: 'motorhome aire nearby' })).fits, 'unknown',
    'a motorhome aire mentioned in the notes was claimed as this spot');
});

// ── 4. Never a permission to sleep ───────────────────────────────────────────
it('overnight is never "yes" — not for an aire, not for anything', () => {
  // THE RULE THIS FILE EXISTS FOR. A parking app cannot grant permission a
  // council can overturn with a sign.
  const all = loadAllSpots();
  const values = new Set(all.map(s => classifyCampervan(s).overnight));
  assert.deepEqual([...values].sort(), ['no', 'unknown'],
    `overnight took a value other than no/unknown: ${[...values].join(', ')}`);
  assert.equal(classifyCampervan(spot({ name: 'Harbour Car Park (Motorhome Aire)' })).overnight, 'unknown',
    'an aire was treated as permission to stay the night');
  // And the bans are read.
  for (const n of ['No overnight parking', 'no overnight or park-and-travel', 'No camping', 'no sleeping in vehicles']) {
    assert.equal(classifyCampervan(spot({ restriction: n })).overnight, 'no', `"${n}" was not read as a ban`);
  }
});

it('the sheet never claims an overnight stay is allowed', () => {
  // The copy is the other half of the rule above: the only positive thing said
  // about an aire is that it is listed as one, followed by a caveat.
  assert.match(appCode, /Listed as a motorhome facility\./, 'the aire line is gone');
  assert.match(appCode, /We can&rsquo;t confirm overnight stays are permitted/,
    'the sheet stopped saying we cannot confirm overnight stays');
  // SWEPT BY SENTENCE, NOT BY PHRASE — and this is the second time in this
  // codebase that lesson has had to be learned. The first version of this
  // flagged the app's own caveat, "We can't confirm overnight stays are
  // permitted", because the negation sits to the LEFT of the phrase. The
  // cancellation-copy sweep had the identical bug against prerender.mjs's
  // accurate "if a host closes the site we refund in full".
  const claim = /overnight (?:parking |stays? )?(?:is |are )?(?:allowed|permitted|fine|ok)\b/gi;
  const negated = /can(?:'|&rsquo;|&#39;)?t|cannot|never|no |not |unable|unconfirmed|check the signs/i;
  const bad = [];
  for (const m of appCode.matchAll(claim)) {
    const start = appCode.lastIndexOf('.', m.index) + 1;
    const end = appCode.indexOf('.', m.index);
    const sentence = appCode.slice(start, end === -1 ? appCode.length : end + 1);
    if (negated.test(sentence)) continue;
    bad.push(sentence.trim().slice(0, 120));
  }
  assert.deepEqual(bad, [],
    `a surface tells a driver overnight parking is allowed: ${bad.join(' | ')}`);
});

// ── The filter ───────────────────────────────────────────────────────────────
it('the filter offers yes and tight, and never a spot that cannot fit', () => {
  assert.equal(isCampervanCandidate(spot({ name: 'X (Motorhome Aire)' })), true);
  assert.equal(isCampervanCandidate(spot({ notes: '3m height barrier' })), true, 'a 3m barrier was hidden');
  assert.equal(isCampervanCandidate(spot({ notes: '1.9m height barrier' })), false);
  assert.equal(isCampervanCandidate(spot({ notes: 'no campervans' })), false);
  assert.equal(isCampervanCandidate(spot()), false, 'an unknown spot was offered as a campervan spot');
  // isCampervanSpot is the stricter one: designated only.
  assert.equal(isCampervanSpot(spot({ notes: '3m height barrier' })), false);
});

it('a warning exists for anything a driver needs to know, and nothing else', () => {
  assert.equal(hasCampervanWarning(spot({ notes: '1.9m height barrier' })), true);
  assert.equal(hasCampervanWarning(spot({ notes: '3m height barrier' })), true);
  assert.equal(hasCampervanWarning(spot({ restriction: 'No overnight parking' })), true);
  assert.equal(hasCampervanWarning(spot()), false, '"we do not know" was rendered as a warning');
});

it('nothing throws on a malformed spot', () => {
  for (const bad of [null, undefined, {}, 'x', 42, { name: null, notes: null }]) {
    assert.doesNotThrow(() => classifyCampervan(bad), `classifyCampervan(${JSON.stringify(bad)}) threw`);
    assert.doesNotThrow(() => barrierHeightM(bad));
  }
  assert.equal(classifyCampervan(null).fits, 'unknown');
  assert.equal(classifyCampervan('x').fits, 'unknown');
});

// ── The wiring ───────────────────────────────────────────────────────────────
it('the chip is in the filter row and in applyChip', () => {
  assert.match(appCode, /\{ id:'campervan', label:'🚐 Campervan' \}/, 'the chip is not offered');
  assert.match(appCode, /if \(chip === 'campervan'\) return arr\.filter\(isCampervanCandidate\);/,
    'the chip does not filter, or does not use the shared predicate');
});

it('the sheet renders the warning only when the data says something', () => {
  assert.match(appCode, /const cv = classifyCampervan\(spot\);/, 'the sheet no longer classifies');
  assert.match(appCode, /if \(cv\.fits === 'unknown' && cv\.overnight !== 'no'\) return null;/,
    'the sheet renders an empty campervan box on the 766 spots that say nothing');
  assert.match(appCode, /Not suitable — \{cv\.note\}/, 'the unsuitable case does not quote the reason');
  assert.match(appCode, /\{cv\.note\} — fine for a low-profile van, not for a coachbuilt/,
    'the tight case does not give the driver the actual height');
});

// ── Against the real dataset ─────────────────────────────────────────────────
it('the real dataset classifies exactly as surveyed', () => {
  // Pinned so a data edit that changes what we tell a campervan driver shows up
  // here rather than on the road. If these move, read the diff before updating.
  const all = loadAllSpots();
  const n = (f) => all.filter(s => classifyCampervan(s).fits === f).length;
  assert.equal(n('yes'), 2, `designated motorhome spots: ${n('yes')}, expected 2`);
  assert.equal(n('tight'), 1, `2.6–3.2m barriers: ${n('tight')}, expected 1`);
  assert.equal(n('no'), 18, `spots a campervan cannot use: ${n('no')}, expected 18`);
  assert.equal(all.filter(s => classifyCampervan(s).overnight === 'no').length, 4);
  // The two real ones, by name — these are the point of the feature.
  const yes = all.filter(isCampervanSpot).map(s => s.name).sort();
  assert.deepEqual(yes, ['Harbour Car Park (Motorhome Aire)', 'Sandhill Drive Motorhome & Overflow Area']);
  // And the big multi-storeys are all excluded.
  const byName = (nm) => all.find(s => s.name === nm);
  for (const nm of ['NCP The Tannery (Francis Street)', 'Titanic Belfast car park',
                    'Lanyon Place Car Park (APCOA)', 'Ocean Terminal Car Park']) {
    const s = byName(nm);
    assert.ok(s, `${nm} is gone from the dataset`);
    assert.equal(classifyCampervan(s).fits, 'no', `${nm} is no longer excluded for a campervan`);
  }
});

it('the vast majority of spots say nothing, and that is reported as nothing', () => {
  // 766 of 787. A classifier that found an answer everywhere would be guessing.
  const all = loadAllSpots();
  const unknown = all.filter(s => classifyCampervan(s).fits === 'unknown').length;
  assert.ok(unknown > all.length * 0.9,
    `only ${unknown} of ${all.length} spots are "unknown" — the classifier is inferring`);
});

console.log(`\n  ${passed} checks passed\n`);
