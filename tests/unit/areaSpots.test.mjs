// The town pages recommended somebody else's car park.
//
// THE DEFECT. inject-area-cta.mjs's own header already named this, for Belfast:
//
//   "/area/belfast.html — the page every social post pointed at — named
//    Victoria Square, CastleCourt, Q-Park, NCP, Titanic and the SSE, and did
//    not mention a single space ParkEasy can sell."
//
// That fix added a block for BOOKABLE inventory. There is bookable inventory in
// exactly ONE town. So the other twenty-three town pages were still ~475 words
// of prose naming the Tower Centre, Fairhill, The Quays and Buttercrane —
// competitors, every one — followed by "We don't have a bookable space in
// Ballymena yet", and nothing else.
//
// Meanwhile ParkEasy holds 8 to 71 publishable spots in each of those towns,
// with prices, free windows and capacities. Not one appeared on the page. We
// were paying for traffic to a page that recommends a competitor.
//
// WHY THE RULES ARE IN src/data/areaSpots.js AND TESTED DIRECTLY. The first
// version had them inline in the build script, and the mutation pass found the
// hole that moved them: deleting `isPublishable` from the filter — which
// publishes every hidden gem in the town to a crawled page, permanently —
// SURVIVED the whole test file, because the only check that could see it read
// the BUILT pages and a test run does not rebuild. A guard that only fires
// after a deploy is not a guard.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { loadAllSpots } from '../../scripts/lib/loadSpots.mjs';
import { isPublishable } from '../../src/data/publicSpots.js';
import { DESTINATIONS } from '../../src/data/destinations.js';
import { spotsForTown, mapLink, detail, median, LIMIT, TIER } from '../../src/data/areaSpots.js';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const scriptRaw = read('../../scripts/inject-area-spots.mjs');
/**
 * The script with its comments stripped.
 *
 * THE RECURRING BUG CLASS IN THIS REPO: a regex matching a file's own comment
 * rather than its code. The "?town= is not a route" check failed on the comment
 * that EXPLAINS why ?town= is not used — the code was right and the test was
 * reading prose.
 */
const script = scriptRaw.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
const pkg = JSON.parse(read('../../package.json'));

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };

console.log('\nareaSpots — the town pages list our spots, not the competition\'s');

const all = loadAllSpots();
const DEST = new Set(DESTINATIONS.map(d => d.slug));
const AREA_DIR = new URL('../../public/area/', import.meta.url);
const townSlugs = readdirSync(AREA_DIR)
  .filter(f => f.endsWith('.html')).map(f => f.replace('.html', ''))
  .filter(s => !DEST.has(s));
const spotsIn = (slug) => spotsForTown(all, slug);

// ── The data the whole thing rests on ────────────────────────────────────────
it('every town page has spots filed under its own slug', () => {
  // `_city` is the key a spot was filed under, and generate-globe-data.mjs
  // notes those keys ARE slugs. A page whose slug matches no spots gets no
  // block and silently stays a competitor directory — which is how `derry`
  // looked empty when first counted by town NAME: the dataset calls that town
  // "Derry~Londonderry".
  assert.equal(townSlugs.length, 24, `${townSlugs.length} town pages, expected 24`);
  const empty = townSlugs.filter(s => spotsIn(s).length === 0);
  assert.deepEqual(empty, [], `town page(s) with no spots under their slug: ${empty.join(', ')}`);
});

it('the thinnest town page still has enough to be worth indexing', () => {
  // ITEM 10 OF THE AUDIT ("stop adding towns") AS A GUARD RATHER THAN A POLICY.
  // A policy nobody enforces is a comment.
  //
  // The floor comes from the gap in the data, not from taste. The thinnest page
  // that exists is Newtownabbey at 8. The towns somebody would be tempted to add
  // next — Armagh, Newtownards, Holywood, Comber, Kilkeel, Limavady,
  // Warrenpoint — hold ONE or TWO spots each. A floor of 8 sits at the bottom of
  // everything shipped and far above every candidate, so it blocks the sprawl
  // without invalidating a single page that exists.
  const FLOOR = 8;
  const thin = townSlugs.map(s => ({ s, n: spotsIn(s).length })).filter(x => x.n < FLOOR);
  assert.deepEqual(thin, [],
    `town page(s) below the ${FLOOR}-spot floor: ${thin.map(x => `${x.s} (${x.n})`).join(', ')} — `
    + 'a page with less than that is a thin duplicate of the towns around it, which is what '
    + 'cost the six destination pages their place in the index');
});

it('the six destination pages are left to their own injector', () => {
  // They live in the same directory and inject-destination-pages.mjs already
  // gives them spots BY COORDINATE, which is right for a page about one
  // building. Their spots are filed under `belfast`, so running over them here
  // would inject nothing while reporting success.
  assert.match(script, /const DESTINATION_SLUGS = new Set\(DESTINATIONS\.map\(d => d\.slug\)\);/,
    'the destination slugs are no longer excluded');
  assert.match(script, /if \(DESTINATION_SLUGS\.has\(slug\)\) continue;/,
    'the skip is gone — a destination page would be double-injected');
  for (const d of DESTINATIONS) {
    assert.equal(spotsIn(d.slug).length, 0,
      `${d.slug} now has spots under its own slug — it should be handled here, not skipped`);
  }
});

// ── 1. The paid product must not leak ────────────────────────────────────────
it('spotsForTown never returns a hidden gem', () => {
  // THE ASSERTION THE MUTATION PASS ADDED. Deleting isPublishable from the
  // filter used to survive this whole file.
  const gems = all.filter(s => s.badge === 'hidden_gem');
  assert.ok(gems.length > 50, `only ${gems.length} gems found — the loader may have changed`);
  for (const g of gems) assert.equal(isPublishable(g), false, `gem "${g.name}" is publishable`);

  const gemNames = new Set(gems.map(g => g.name));
  for (const slug of townSlugs) {
    const leaked = spotsIn(slug).filter(s => s.badge === 'hidden_gem' || gemNames.has(s.name));
    assert.deepEqual(leaked.map(s => s.name), [],
      `spotsForTown('${slug}') returns hidden gem(s) — they would be published to a crawled page`);
  }
  // A gem handed straight in is refused too, not merely absent from the data.
  assert.deepEqual(
    spotsForTown([{ _city: 't', badge: 'hidden_gem', name: 'Secret Lane', lat: 54, lng: -6 }], 't'),
    [], 'a hidden gem passed straight in is still selected');
  // And a spot with no coordinates or no name cannot be listed either.
  assert.deepEqual(spotsForTown([{ _city: 't', badge: 'official', lat: 54, lng: -6 }], 't'), []);
  assert.deepEqual(spotsForTown([{ _city: 't', badge: 'official', name: 'X' }], 't'), []);
});

it('the build fails if a gem name reaches a finished page', () => {
  // This catches a gem named in the hand-written PROSE, which spotsForTown
  // cannot see.
  assert.match(script, /const leaked = \[\.\.\.gemNames\]\.filter\(n => html\.includes\(n\)\);/,
    'the finished-page gem check is gone');
  assert.ok(/throw new Error\(/.test(script) && /names \$\{leaked\.length\} hidden gem/.test(scriptRaw),
    'a leaked gem no longer fails the build');
  // After the block is inserted, and before the file is written.
  const iInsert = script.indexOf('html = html.slice(0, at) + body');
  const iCheck = script.indexOf('const leaked =');
  const iWrite = script.indexOf('writeFileSync(path, html)');
  assert.ok(iInsert !== -1 && iCheck > iInsert, 'the gem check runs before the block is inserted');
  assert.ok(iWrite > iCheck, 'the page is written before the gem check');
});

// ── 2. The CTA has to go somewhere ───────────────────────────────────────────
it('the CTA uses a deep link the app actually parses', () => {
  // ?town= is not a route. App.jsx reads `near` and `place`.
  const u = mapLink(spotsIn('ballymena'), 'Ballymena');
  assert.ok(!/[?&]town=/.test(u), `the CTA uses a town parameter the app ignores: ${u}`);
  assert.match(u, /^https:\/\/parkeasy\.uk\/\?near=-?\d+\.\d{4},-?\d+\.\d{4}&place=Ballymena$/,
    `the CTA is not the near/place deep link: ${u}`);
  const app = read('../../src/App.jsx');
  assert.match(app, /const near = p\.get\('near'\);/, 'App.jsx no longer parses `near`');
  assert.match(app, /p\.get\('place'\)/, 'App.jsx no longer parses `place`');
  // A town name with a space has to survive the URL.
  assert.match(mapLink(spotsIn('newtownabbey'), 'Newtownabbey, Co Antrim'),
    /place=Newtownabbey%2C%20Co%20Antrim$/, 'the place label is not URL-encoded');
});

it('the CTA centre is the median, which one mis-filed spot cannot move', () => {
  // THE CONCRETE CASE. Add one spot at (0,0) — a town-key typo is all it takes
  // — and the MEAN of Ballymena's spots lands at 51.6366, in the sea off
  // Cornwall, with the CTA sending every visitor there. The median does not
  // move past the fourth decimal.
  const spots = spotsIn('ballymena');
  assert.ok(spots.length > 10, `only ${spots.length} Ballymena spots`);
  const latOf = (u) => Number(u.match(/near=(-?[\d.]+),/)[1]);
  const good = latOf(mapLink(spots, 'Ballymena'));
  const skewed = latOf(mapLink(
    [...spots, { name: 'Mis-filed', badge: 'official', lat: 0, lng: 0, _city: 'ballymena' }],
    'Ballymena'));
  assert.ok(Math.abs(good - skewed) < 0.01,
    `one mis-filed spot moved the CTA from ${good} to ${skewed} — that is a mean, not a median`);
  assert.ok(good > 54.8 && good < 54.93, `Ballymena centre latitude is ${good}`);
  // Nothing to centre on is null, not 0,0 — which is also in the sea.
  assert.equal(mapLink([], 'X'), null);
  assert.equal(mapLink(null, 'X'), null);
  assert.equal(median([]), null);
  assert.equal(median(['x', null]), null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
});

// ── 3. Nothing is claimed that is not known ──────────────────────────────────
it('no distance and no walking time is printed', () => {
  // A destination page can say "4 min walk · 310 m" because it knows the
  // postcode it measures from. A town page has no such point.
  const line = detail({ restriction: 'Mon-Sat 7am-10pm', price: '70p/hr', spaces: 812,
                        lat: 54.86, lng: -6.27, near: 'Tower Centre' });
  assert.ok(!/walk|metre|\bkm\b/i.test(line), `the row claims a distance: "${line}"`);
  assert.ok(!/min walk|walkMin|metresBetween|walkMinutes/.test(script),
    'the injector claims a distance or a walking time it has no reference point for');
});

it('the price is printed once per row, not twice', () => {
  // THE BUG THE FINISHED PAGE SHOWED. detail() originally included s.price and
  // so does the row's right-hand chip, so every paid spot read
  // "£1/hr (1st hr) ... · £1/hr (1st hr) · 1100 spaces".
  const line = detail({ restriction: 'Mon-Sat 7am-10pm', price: '70p/hr', spaces: 812 });
  assert.equal(line, 'Mon-Sat 7am-10pm · 812 spaces');
  assert.ok(!line.includes('70p'), `the price is in the detail line as well as the chip: "${line}"`);
  // A zero or absent capacity is not printed as a claim.
  assert.equal(detail({ restriction: 'Free' }), 'Free');
  assert.equal(detail({ restriction: 'Free', spaces: 0 }), 'Free');
  assert.equal(detail({}), '');
});

it('the copy is honest about the cap and about what changes', () => {
  assert.equal(LIMIT, 14, 'the cap moved — check the copy still matches');
  assert.match(script, /\$\{shown\.length\} of the \$\{total\} spots/,
    'a truncated list no longer says it is truncated');
  // IN BOTH BRANCHES OF THE COPY. The capped and uncapped wordings are written
  // separately, and a single match let the warning be deleted from the capped
  // one — which is 16 of the 24 pages. Same shape as the "Free First" hole in
  // spotRanking.test.mjs: two call sites, one assertion.
  const warned = (script.match(/Prices and restrictions change — check the signs when you arrive/g) || []).length;
  assert.equal(warned, 2,
    `the stale-data warning is in ${warned} of the 2 copy branches — the capped pages (16 of 24) `
    + 'and the uncapped ones each have their own wording');
  // Which towns are capped: if this set changes, the "See all" copy starts
  // appearing on pages nobody expected.
  const over = townSlugs.filter(s => spotsIn(s).length > LIMIT).sort();
  assert.deepEqual(over, ['ballymena', 'banbridge', 'belfast', 'coleraine', 'craigavon',
    'derry', 'downpatrick', 'dungannon', 'enniskillen', 'larne', 'magherafelt', 'newcastle',
    'newry', 'portadown', 'portrush', 'strabane'],
    'which towns exceed the cap has changed — the "See all" copy now appears on a different set');
});

it('the spot order is real car parks first, then stable alphabetically', () => {
  assert.deepEqual(TIER, { official: 0, paid: 1, timed: 2 }, 'the tier order changed');
  const fx = [
    { _city: 't', badge: 'free',     name: 'Zebra Street',        lat: 54, lng: -6 },
    { _city: 't', badge: 'official', name: 'Bravo Car Park',      lat: 54, lng: -6 },
    { _city: 't', badge: 'timed',    name: 'Alpha Road',          lat: 54, lng: -6 },
    { _city: 't', badge: 'official', name: 'Alpha Car Park',      lat: 54, lng: -6 },
    { _city: 't', badge: 'paid',     name: 'Charlie Multi-Storey', lat: 54, lng: -6, price: '£1/hr' },
  ];
  assert.deepEqual(spotsForTown(fx, 't').map(s => s.name),
    ['Alpha Car Park', 'Bravo Car Park', 'Charlie Multi-Storey', 'Alpha Road', 'Zebra Street'],
    'the order is no longer real car parks first, then alphabetical within a tier');
  // Stable: the same input in any order gives the same output, or the built
  // pages reshuffle between builds and every diff looks like a data change.
  assert.deepEqual(spotsForTown([...fx].reverse(), 't').map(s => s.name),
    spotsForTown(fx, 't').map(s => s.name),
    'the order depends on input order');
  // De-duplicated by name: the same lay-by is filed under two towns.
  assert.equal(spotsForTown([
    { _city: 't', badge: 'official', name: 'The Same Lay-by', lat: 54, lng: -6 },
    { _city: 't', badge: 'free',     name: 'the same lay-by ', lat: 54, lng: -6 },
  ], 't').length, 1, 'the same spot is listed twice');
  // Another town's spots are never pulled in.
  assert.deepEqual(spotsForTown([{ _city: 'other', badge: 'official', name: 'Elsewhere', lat: 54, lng: -6 }], 't'), []);
});

// ── Wiring ───────────────────────────────────────────────────────────────────
it('the step is in the build, after prerender has written the pages', () => {
  const build = pkg.scripts.build;
  assert.ok(build.includes('inject-area-spots.mjs'), 'the step is not in npm run build');
  assert.ok(build.indexOf('prerender.mjs') < build.indexOf('inject-area-spots.mjs'),
    'the step runs before prerender, so there are no pages to inject into');
  assert.ok(build.indexOf('inject-area-cta.mjs') < build.indexOf('inject-area-spots.mjs'),
    'the step runs before the booking block — the two blocks would be out of order');
});

it('a missing dist never fails the build', () => {
  // A broken deploy costs more than an un-upgraded page — the rule
  // inject-area-cta.mjs set and this follows.
  assert.match(script, /if \(!existsSync\(DIR\)\) \{[\s\S]*?process\.exit\(0\);/,
    'a missing dist/area now throws instead of skipping');
});

// ── The built pages, when there are any ──────────────────────────────────────
const DIST = new URL('../../dist/area/', import.meta.url);
if (!existsSync(DIST)) {
  console.log('  SKIP  built-page checks — no dist/area (run npm run build)');
} else {
  it('every town page got its block, and no destination page did', () => {
    for (const slug of townSlugs) {
      const html = readFileSync(new URL(`${slug}.html`, DIST), 'utf8');
      assert.ok(html.includes('id="pe-area-spots"'), `${slug}.html has no spots block`);
      assert.ok(html.includes('Parking spots we know about in'), `${slug}.html block has no heading`);
    }
    for (const d of DESTINATIONS) {
      const html = readFileSync(new URL(`${d.slug}.html`, DIST), 'utf8');
      assert.ok(!html.includes('id="pe-area-spots"'),
        `${d.slug}.html was injected twice — it belongs to the destination injector`);
    }
  });

  it('no built town page names a hidden gem', () => {
    const gemNames = [...new Set(all.filter(s => s.badge === 'hidden_gem')
      .map(s => String(s.name || '').trim()).filter(n => n.length > 3))];
    const bad = [];
    for (const slug of townSlugs) {
      const html = readFileSync(new URL(`${slug}.html`, DIST), 'utf8');
      for (const n of gemNames) if (html.includes(n)) bad.push(`${slug}: ${n}`);
    }
    assert.deepEqual(bad, [], `a hidden gem reached an indexed page: ${bad.slice(0, 5).join(' | ')}`);
  });

  it('the pages got materially longer, and with specifics', () => {
    // 475 words of competitor prose was the starting point. A block that adds
    // nothing readable would still pass every structural check above.
    const words = (slug) => readFileSync(new URL(`${slug}.html`, DIST), 'utf8')
      .replace(/<(script|style)[\s\S]*?<\/\1>/g, '').replace(/<[^>]+>/g, ' ')
      .split(/\s+/).filter(Boolean).length;
    for (const slug of ['ballymena', 'newry', 'omagh']) {
      assert.ok(words(slug) > 600, `${slug}.html is only ${words(slug)} words`);
    }
    // And the specifics are real: a capacity from the dataset, properly escaped.
    const bally = readFileSync(new URL('ballymena.html', DIST), 'utf8');
    assert.match(bally, /1100 spaces/, 'the Fairhill capacity is not on the page');
    assert.match(bally, /Park &amp; Ride/, 'the Park & Ride is missing, or its ampersand is unescaped');
  });
}

it('docs/area-pages.md records the floor and the two things never claimed', () => {
  const docs = readFileSync(new URL('../../docs/area-pages.md', import.meta.url), 'utf8');
  assert.match(docs, /at least 8 publishable spots/,
    'the docs do not state the floor that implements "stop adding towns"');
  assert.match(docs, /Derry~Londonderry/,
    'the docs do not record the slug-vs-name near-miss');
  assert.match(docs, /hidden gem/i, 'the docs do not record the gem rule');
  assert.match(docs, /No distance and no walking time/,
    'the docs do not record that no distance may be claimed');
  assert.match(docs, /\?town=<slug>`\s*\*\*is not a route/,
    'the docs do not record why the CTA is a near/place link');
});

console.log(`\n  ${passed} checks passed\n`);
