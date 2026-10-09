// What "Recommended" puts first, and the thing it was putting last.
//
// THE DEFECT. The default sort is `popular`, labelled **Recommended**, and it
// ranked by `spot.votes`. Those are seed weights — the sort's own comment says
// "a couple of thousand of them across 297 spots, none given by a driver", and
// the label was walked back from "Most Popular" for exactly that reason.
//
// What nobody noticed is that every bookable ParkEasy listing is built with
// `votes: 0`. So the one kind of space ParkEasy can guarantee, and the only
// kind it earns anything from, sorted BELOW all ~740 seed spots — at the very
// bottom of a list telling the driver these were our recommendations. Nothing
// threw. The list looked perfectly sorted.
//
// THE TWO WAYS THE FIX GOES WRONG, both silent:
//
//   1. PROMOTING A SPACE THAT CANNOT BE BOOKED. A live listing outside its
//      availability window is mapped to badge 'paid' when sellable and 'free'
//      when not. Ranking on the badge would put a space whose Reserve button
//      never appears at the top of the list — the same lie the card copy was
//      fixed for in an earlier release.
//   2. REORDERING WITHOUT SAYING SO. This change also puts the revenue line on
//      top. The free spots are not hidden or demoted below anything new, but a
//      list that silently re-ranks itself in the operator's favour is the thing
//      the audit criticised in every comparable. So there is a note on the
//      page, on BOTH results surfaces, and this file checks it is on both.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  isBookable, recommendedTier, compareRecommended, bookableCount,
} from '../../src/data/spotRanking.js';

const app = readFileSync(new URL('../../src/App.jsx', import.meta.url), 'utf8');
const appCode = app.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };

console.log('\nspotRanking — Recommended now recommends something');

const order = (spots) => [...spots].sort(compareRecommended).map(s => s.id);

// ── The defect itself ────────────────────────────────────────────────────────
it('a bookable space with no votes outranks a seed spot with 900', () => {
  // THE BUG, in one assertion. Before this, 'rental' came last.
  assert.deepEqual(order([
    { id: 'seed-900', votes: 900 },
    { id: 'rental', bookable: true, votes: 0 },
    { id: 'seed-400', votes: 400 },
  ]), ['rental', 'seed-900', 'seed-400']);
});

it('a featured bookable space outranks the other bookable ones', () => {
  // rental_listings.featured already decides which space takes the promoted
  // slot on the map. Honouring it here keeps that decision in one place.
  assert.deepEqual(order([
    { id: 'b', bookable: true, votes: 0 },
    { id: 'f', bookable: true, featured: true, votes: 0 },
    { id: 'seed', votes: 900 },
  ]), ['f', 'b', 'seed']);
});

it('featured on a NON-bookable spot promotes nothing', () => {
  // `featured` is a column on rental_listings. A seed spot carrying the flag
  // must not jump the queue on the strength of a field that does not apply.
  assert.equal(recommendedTier({ featured: true, votes: 1 }), 2);
  assert.deepEqual(order([
    { id: 'seed-featured', featured: true, votes: 1 },
    { id: 'seed-high', votes: 900 },
  ]), ['seed-high', 'seed-featured']);
});

// ── Failure mode 1: promoting what cannot be booked ──────────────────────────
it('a listing that cannot be sold right now is not promoted', () => {
  // Belfast Royal Academy: status 'active', availability window closed in
  // August. It appears in the list, badged 'free', with no Reserve button.
  // Promoting it would put a space nobody can book at the top.
  const closed = { id: 'bra', rental: true, bookable: false, badge: 'free', votes: 0 };
  assert.equal(isBookable(closed), false);
  assert.equal(recommendedTier(closed), 2);
  assert.deepEqual(order([closed, { id: 'seed', votes: 1 }]), ['seed', 'bra']);
});

it('bookability is read from the explicit flag, never from the badge', () => {
  // Mutation: rank on badge === 'paid' and the closed listing above rises.
  assert.equal(isBookable({ badge: 'paid' }), false, 'a badge alone made something bookable');
  assert.equal(isBookable({ rental: true }), false, 'being a rental alone made something bookable');
  assert.equal(isBookable({ bookable: 'yes' }), false, 'a truthy non-boolean counted');
  assert.equal(isBookable({ bookable: 1 }), false);
  assert.equal(isBookable({ bookable: true }), true);
  assert.equal(isBookable(null), false);
  assert.equal(isBookable(undefined), false);
});

it('App.jsx sets the flag from sellableNow, the same test checkout uses', () => {
  assert.match(appCode, /bookable: sellableNow\(l\),/,
    'the bookable flag is no longer derived from sellableNow — the list and checkout can disagree');
  assert.match(appCode, /if \(sortBy === 'popular'\) return compareRecommended\(a, b\);/,
    'the Recommended sort no longer uses the shared comparator');
  assert.ok(!/if \(sortBy === 'popular'\) return b\.votes - a\.votes;/.test(appCode),
    'the Recommended sort is ranking by raw seed votes again');
});

// ── Stability ────────────────────────────────────────────────────────────────
it('the order is stable, so the list does not reshuffle under a thumb', () => {
  // An unstable comparator makes a list visibly re-order on every keystroke.
  // Three spots identical in every ranked field must come out in id order.
  const tie = [{ id: 'c', votes: 5 }, { id: 'a', votes: 5 }, { id: 'b', votes: 5 }];
  assert.deepEqual(order(tie), ['a', 'b', 'c']);
  assert.deepEqual(order([...tie].reverse()), ['a', 'b', 'c']);
  // And bookable ties too.
  const bt = [{ id: 'z', bookable: true }, { id: 'y', bookable: true }];
  assert.deepEqual(order(bt), ['y', 'z']);
  assert.deepEqual(order([...bt].reverse()), ['y', 'z']);
});

it('missing, null and non-numeric votes do not throw or win', () => {
  // `votes` is seed data and a new mapping can omit it entirely.
  assert.deepEqual(order([
    { id: 'none' }, { id: 'nul', votes: null }, { id: 'str', votes: 'lots' }, { id: 'ten', votes: 10 },
  ]), ['ten', 'none', 'nul', 'str']);
  assert.doesNotThrow(() => [null, undefined, {}].sort(compareRecommended));
});

// ── Failure mode 2: reordering without saying so ─────────────────────────────
it('bookableCount counts only what can be booked', () => {
  assert.equal(bookableCount([
    { bookable: true }, { bookable: false }, { badge: 'paid' }, {}, { bookable: true },
  ]), 2);
  assert.equal(bookableCount([]), 0);
  assert.equal(bookableCount(null), 0);
  assert.equal(bookableCount(undefined), 0);
});

it('the note is rendered on BOTH results surfaces', () => {
  // One present and the other missing is worse than neither, because it
  // implies the other surface was not reordered. Both share `sortBy` and
  // `filtered`, so both are.
  const renders = [...appCode.matchAll(/<RankNote sortBy=\{sortBy\} spots=\{filtered\}\/>/g)];
  assert.equal(renders.length, 2,
    `RankNote renders ${renders.length} time(s) — the list and the map sheet are both reordered`);
  // Both sites must come before the list they describe.
  const listIdx = appCode.indexOf('{filtered.length === 0 ? emptyState');
  assert.ok(renders[0].index < listIdx, 'the note renders below the results it explains');
});

it('the note appears only on the Recommended sort, and only when it applies', () => {
  assert.match(appCode, /if \(sortBy !== 'popular' \|\| bookableCount\(spots\) === 0\) return null;/,
    'RankNote no longer gates on the sort and on there being something bookable');
  // The copy has to say both halves: what moved up, and how to undo it.
  assert.match(app, /Spaces you can reserve are shown first/,
    'the note no longer says what was promoted');
  assert.match(app, /for free spots first/,
    'the note no longer tells the driver how to get the free spots back');
  // "Free First" has to be a sort that actually exists, or the note sends
  // somebody looking for a button that is not there — and it is defined
  // TWICE, in SORT_OPTIONS_FREE and SORT_OPTIONS_PREMIUM. A mutation renaming
  // one of them survived an assertion that only needed a single match, which
  // would have left half the users reading a note that points nowhere.
  const freeFirst = (app.match(/\{ id:'free',\s+label:'Free First' \}/g) || []).length;
  assert.equal(freeFirst, 2,
    `"Free First" is a sort option in ${freeFirst} of the 2 sort lists — the note points at `
    + 'a button that does not exist for the other kind of user');
  // Both lists exist and both are offered somewhere, so neither is dead code.
  for (const name of ['SORT_OPTIONS_FREE', 'SORT_OPTIONS_PREMIUM']) {
    assert.ok(appCode.includes(name), `${name} is gone — the count above means nothing`);
  }
});

it('the free spots keep their existing order among themselves', () => {
  // The claim in the note is that free spots are not demoted below anything
  // NEW — only that bookable ones moved above them. So tier 2's internal
  // order must be exactly the old `b.votes - a.votes`.
  const seeds = [
    { id: 'a', votes: 100 }, { id: 'b', votes: 900 }, { id: 'c', votes: 500 },
  ];
  const oldWay = [...seeds].sort((x, y) => y.votes - x.votes).map(s => s.id);
  assert.deepEqual(order(seeds), oldWay, 'the ordering of non-bookable spots changed');
});

it('community finds are not demoted by this change', () => {
  // Real driver submissions also carry votes: 0, so they were already at the
  // bottom of the vote ranking. They stay exactly where they were — this
  // change moves bookable spaces up, it does not move anything else down.
  const community = { id: 'comm', community: true, votes: 0 };
  assert.equal(recommendedTier(community), 2);
  assert.equal(recommendedTier({ id: 'seed', votes: 900 }), 2,
    'a seed spot and a community find are no longer in the same tier');
});

// ── No "Official" tier ───────────────────────────────────────────────────────
it('the official badge is not repurposed as a commercial tier', () => {
  // `official` means a real car park with a named operator, as against a
  // street somebody guessed at, and it is on roughly sixty NCP, Q-Park,
  // council and Translink car parks with NO ParkEasy relationship. Selling it
  // to a venue would sell a label those sixty already carry for free and
  // destroy the one thing the badge conveys.
  const mod = readFileSync(new URL('../../src/data/spotRanking.js', import.meta.url), 'utf8');
  const code = mod.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert.ok(!/official/i.test(code),
    'spotRanking.js ranks on the official badge — it is a factual classification, not a tier');
  // And the badge still means what it meant: unchanged, still on the NCP rows.
  assert.match(app, /official:\s+\{ label: '🅿 Official'/, 'the official badge definition changed');
  // badge:'official' in the seed rows, with no space after the colon.
  assert.ok(app.includes("name:'NCP Dublin Road'"), 'the NCP Dublin Road row is gone');
  assert.match(app, /NCP Dublin Road[\s\S]{0,400}?badge:\s*'official'/,
    'NCP Dublin Road is no longer badged official — the classification was repurposed');
  // And it is on many rows, not one: the point is that ~60 car parks carry it.
  const officialRows = (app.match(/badge:\s*'official'/g) || []).length;
  assert.ok(officialRows > 40,
    `only ${officialRows} rows are badged official — if that collapsed, the badge was repurposed`);
});

it('docs/booking-path.md records the trade this change makes', () => {
  const docs = readFileSync(new URL('../../docs/booking-path.md', import.meta.url), 'utf8');
  assert.match(docs, /Recommended/, 'the Recommended order is undocumented');
  assert.match(docs, /revenue/i,
    'the docs do not record that this ordering also favours ParkEasy — which is the '
    + 'half a future reader needs in order to disagree with it');
  assert.match(docs, /Official/,
    'the docs do not record why there is no Official tier');
});

console.log(`\n  ${passed} checks passed\n`);
