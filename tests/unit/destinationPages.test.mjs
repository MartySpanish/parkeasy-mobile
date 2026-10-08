// The six destination pages: worth indexing, and not giving the product away.
//
// /area/qub.html, botanic, city-hospital, sse-arena, titanic-quarter and
// cathedral-quarter target the highest-intent parking queries ParkEasy owns.
// All six shipped as ~130 words of boilerplate with the place name swapped, so
// PR #194 noindexed them and cut the sitemap from 31 to 25 — right on thin
// near-duplicate content, and it left the best six URLs in the product
// invisible.
//
// The fix is to earn the index back, which means two things have to hold at
// once: the pages have to say something real, and they must not say the one
// thing that is for sale. Hidden gems are what Premium buys, and the FIRST
// DRAFT of destinations.js named two of them in prose — Riddel Hall under
// Queen's and the Stranmillis Road free car park under Botanic. Both are
// hidden_gem rows. That is the failure this file exists for.
//
// Every assertion below was confirmed by breaking the rule it covers.
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { DESTINATIONS, bySlug } from '../../src/data/destinations.js';
import {
  isPublishable, nearestPublishable, metresBetween, walkMinutes, OPEN_BADGES,
} from '../../src/data/publicSpots.js';
import { loadAllSpots } from '../../scripts/lib/loadSpots.mjs';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
/** Source with // comments stripped: a regex must match code, not a note about it. */
const code = p => read(p).split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };

console.log('\ndestinationPages — real content, and never the paid product');

const all = loadAllSpots();
const gemNames = [...new Set(
  all.filter(s => s.badge === 'hidden_gem').map(s => s.name)
    .filter(n => n && String(n).trim().length > 3).map(n => String(n).trim()),
)];

//------------------------------------------------------------- the paywall
it('the gem set is not empty, so this test is actually testing something', () => {
  // If gems ever stopped existing, every assertion below would pass vacuously.
  assert.ok(gemNames.length > 50, `only ${gemNames.length} gem names — has the data moved?`);
});

it('isPublishable refuses every hidden gem', () => {
  // Mutation: drop the hidden_gem clause and 132 gems become publishable.
  const gems = all.filter(s => s.badge === 'hidden_gem');
  assert.ok(gems.length > 50, 'no gems to check');
  for (const g of gems) {
    assert.equal(isPublishable(g), false, `gem is publishable: ${g.name}`);
  }
});

it('isPublishable refuses a premium-flagged spot that is not a gem', () => {
  // The EV picks. Mutation: `spot.premium !== true` → `true`.
  assert.equal(isPublishable({ name: 'X', badge: 'free', lat: 1, lng: 1, premium: true }), false);
  assert.equal(isPublishable({ name: 'X', badge: 'free', lat: 1, lng: 1, premium: false }), true);
});

it('isPublishable allows what a driver already pays for or is restricted at', () => {
  for (const badge of OPEN_BADGES) {
    assert.equal(isPublishable({ name: 'X', badge, lat: 1, lng: 1, premium: true }), true,
      `${badge} was withheld — car parks and on-street are not the paid product`);
  }
  // A priced spot is free to view whatever its badge.
  assert.equal(isPublishable({ name: 'X', badge: 'free', lat: 1, lng: 1, premium: true, price: '£2/hr' }), true);
});

it('isPublishable refuses a spot with no name or no coordinate', () => {
  // A row that cannot be printed or placed must not reach a page at all.
  assert.equal(isPublishable({ badge: 'free', lat: 1, lng: 1 }), false);
  assert.equal(isPublishable({ name: 'X', badge: 'free', lat: null, lng: 1 }), false);
  assert.equal(isPublishable({ name: 'X', badge: 'free', lat: 1, lng: NaN }), false);
  assert.equal(isPublishable(null), false);
  assert.equal(isPublishable('nope'), false);
});

it('isPublishable mirrors App.jsx isGated, clause by clause', () => {
  // THE DIVERGENCE GUARD. publicSpots.js cannot import App.jsx (React, Leaflet),
  // so the rule is a copy — and a copy that drifts is how the publish gate
  // broke earlier: one half was relaxed and the other was not.
  const app = code('../../src/App.jsx');
  const gate = app.slice(app.indexOf('const isGated = (spot) =>'));
  const body = gate.slice(0, gate.indexOf('};') + 2);
  assert.match(body, /spot\.badge === 'hidden_gem'/, 'isGated no longer locks every hidden gem');
  assert.match(body, /if \(spot\.price\) return false/, 'isGated no longer unlocks paid parking');
  assert.match(body, /\['official','timed','paid'\]\.includes\(spot\.badge\)/,
    'the open-badge list moved in App.jsx and publicSpots.js was not updated');
  assert.match(body, /return spot\.premium === true/, 'the premium-flag fallback changed');
  // SET EQUALITY, BOTH WAYS. Checking only that every OPEN_BADGES entry appears
  // in isGated caught an added badge and missed a REMOVED one: deleting 'paid'
  // from OPEN_BADGES left this test green while every paid car park silently
  // stopped being publishable. Found by mutation, so the list is parsed out of
  // App.jsx and compared as a set.
  const appBadges = body.match(/\[((?:'[a-z]+',?)+)\]\.includes\(spot\.badge\)/);
  assert.ok(appBadges, 'the open-badge list is no longer an inline array in isGated');
  const fromApp = appBadges[1].split(',').map(x => x.trim().replace(/'/g, '')).filter(Boolean);
  assert.deepEqual([...OPEN_BADGES].sort(), fromApp.sort(),
    `OPEN_BADGES is ${JSON.stringify(OPEN_BADGES)} but isGated uses ${JSON.stringify(fromApp)} — `
    + 'one was changed without the other, so a whole class of spot has silently changed side');
  // And the taster dial: at 0 there are no free gems. If somebody re-opens
  // them in the app that is a decision about the upsell, not a decision to
  // publish those coordinates to Google, so this fails loudly either way.
  assert.match(app, /const FREE_GEMS_TOTAL = 0;/,
    'FREE_GEMS_TOTAL is no longer 0 — decide deliberately whether taster gems may be '
    + 'published on an indexed page, then update publicSpots.js and this assertion');
});

//---------------------------------------------------------------- the content
it('every destination has a coordinate, a postcode and three FAQs', () => {
  assert.equal(DESTINATIONS.length, 6);
  for (const d of DESTINATIONS) {
    assert.ok(/^[a-z-]+$/.test(d.slug), d.slug);
    assert.ok(Number.isFinite(d.lat) && Number.isFinite(d.lng), `${d.slug} has no coordinate`);
    // Belfast, roughly. A transposed sign or a swapped lat/lng lands outside.
    assert.ok(d.lat > 54.4 && d.lat < 54.8, `${d.slug} lat ${d.lat} is not in Belfast`);
    assert.ok(d.lng > -6.2 && d.lng < -5.7, `${d.slug} lng ${d.lng} is not in Belfast`);
    assert.match(d.postcode, /^BT\d+ ?\d?[A-Z]{0,2}$/, `${d.slug} postcode ${d.postcode}`);
    assert.equal(d.faqs.length, 3, `${d.slug} has ${d.faqs.length} FAQs`);
    for (const [q, a] of d.faqs) {
      assert.ok(q.endsWith('?'), `not a question: ${q}`);
      assert.ok(a.length > 80, `${d.slug} answer is ${a.length} chars — too thin to earn an index`);
    }
    assert.ok(d.lede.length > 100, `${d.slug} lede is ${d.lede.length} chars`);
  }
});

it('no destination prose names a hidden gem', () => {
  // The exact failure of the first draft, caught at the data layer as well as
  // in the build step. Mutation: put "Riddel Hall" back in the qub lede.
  const prose = JSON.stringify(DESTINATIONS);
  const leaked = gemNames.filter(n => prose.includes(n));
  assert.deepEqual(leaked, [], `destinations.js names gems: ${leaked.join(', ')}`);
});

it('every destination has at least three real spots to talk about', () => {
  // Below three the page has nothing to say and the injector leaves it
  // noindexed. If that ever becomes true for a slug in the sitemap, the two
  // disagree — which the sitemap assertion below catches.
  for (const d of DESTINATIONS) {
    const rows = nearestPublishable(all, d, { radiusM: 1200, limit: 8 });
    assert.ok(rows.length >= 3, `${d.slug} has only ${rows.length} publishable spots within 1.2km`);
    for (const r of rows) {
      assert.equal(r.spot.badge === 'hidden_gem', false, `${d.slug} would print gem ${r.spot.name}`);
      assert.ok(r.metres <= 1200, `${d.slug}: ${r.spot.name} is ${r.metres}m away`);
      assert.ok(r.walkMin >= 1, 'a walk of under a minute reads as zero');
    }
  }
});

it('the nearest list is sorted, capped and free of duplicates', () => {
  const rows = nearestPublishable(all, bySlug('cathedral-quarter'), { radiusM: 1200, limit: 5 });
  assert.equal(rows.length, 5, 'the limit is not applied');
  for (let i = 1; i < rows.length; i++) {
    assert.ok(rows[i].metres >= rows[i - 1].metres, 'not sorted by distance');
  }
  const names = rows.map(r => String(r.spot.name).toLowerCase());
  assert.equal(new Set(names).size, names.length, 'the same spot is listed twice');
  // Mutation: drop the de-dupe and a lay-by filed under two towns appears twice.
  const dup = [{ name: 'Same', badge: 'free', lat: 54.6009, lng: -5.9281 },
    { name: 'same', badge: 'free', lat: 54.6010, lng: -5.9281 }];
  assert.equal(nearestPublishable(dup, bySlug('cathedral-quarter')).length, 1);
});

it('distance and walking time are the real thing, not a placeholder', () => {
  // ~111.32 km per degree of latitude.
  assert.ok(Math.abs(metresBetween(54.6, -5.9, 54.609, -5.9) - 1001.88) < 2);
  // Longitude shrinks with latitude; ignoring cos(lat) overstates east-west
  // distance by ~42% in Belfast.
  const ew = metresBetween(54.6, -5.9, 54.6, -5.8847);
  assert.ok(ew > 950 && ew < 1050, `east-west metres ${ew} — is cos(lat) applied?`);
  assert.equal(walkMinutes(0), 1, 'a zero-metre walk must still read as a minute');
  assert.equal(walkMinutes(800), 10);
});

//---------------------------------------------------------------- the wiring
it('the sitemap lists exactly the six, and the build runs the injector', () => {
  const sitemap = code('../../api/sitemap.js');
  for (const d of DESTINATIONS) {
    assert.ok(sitemap.includes(`/area/${d.slug}.html`),
      `${d.slug} is upgraded but missing from the sitemap`);
  }
  const pkg = JSON.parse(read('../../package.json'));
  assert.match(pkg.scripts.build, /inject-destination-pages\.mjs/,
    'the build no longer runs the injector, so the pages ship thin AND noindexed — '
    + 'while the sitemap lists them');
  // Order matters: the injector edits what inject-area-cta wrote.
  assert.ok(pkg.scripts.build.indexOf('inject-area-cta') < pkg.scripts.build.indexOf('inject-destination-pages'),
    'the destination injector runs before inject-area-cta');
});

it('the injector strips the noindex only after it has added the content', () => {
  const src = code('../../scripts/inject-destination-pages.mjs');
  assert.ok(src.indexOf('writeFileSync(file, html)') > src.indexOf('name="robots"'),
    'the robots meta is handled after the page is written');
  assert.ok(src.indexOf('id="pe-destination"') < src.indexOf('name="robots"'),
    'the noindex is stripped before the content block is built — a thin page would go live');
  assert.match(src, /if \(rows\.length < 3\)/,
    'a destination with nothing to say would now be un-noindexed anyway');
  assert.match(src, /throw new Error\(\s*`inject-destination-pages: \$\{d\.slug\}\.html names/,
    'the gem leak no longer throws, so a paid spot can reach Google');
});

it('the injector asserts on the finished page, prose included', () => {
  const src = code('../../scripts/inject-destination-pages.mjs');
  // Checking `rows` alone would miss a gem named in a lede or an FAQ, which is
  // exactly how the first draft leaked two.
  assert.match(src, /const leaked = \[\.\.\.gemNames\]\.filter\(n => html\.includes\(n\)\)/,
    'the leak check no longer runs against the whole page');
  assert.ok(src.indexOf('html = html.slice(0, at) + body') < src.indexOf('const leaked'),
    'the leak check runs before the content is inserted, so it cannot see it');
});

//---------------------------------------------------------------- the output
const DIR = new URL('../../dist/area/', import.meta.url);
if (!existsSync(DIR)) {
  console.log('  SKIP  built-page checks — no dist/area (run npm run build)');
} else {
  it('every built destination page is indexable and carries its schema', () => {
    for (const d of DESTINATIONS) {
      const f = new URL(`${d.slug}.html`, DIR);
      assert.ok(existsSync(f), `${d.slug}.html was not built`);
      const html = readFileSync(f, 'utf8');
      assert.ok(!/content="noindex/.test(html), `${d.slug} is still noindexed`);
      assert.match(html, /"@type":"FAQPage"/, `${d.slug} has no FAQPage schema`);
      assert.match(html, /"@type":"ParkingFacility"/, `${d.slug} has no ParkingFacility schema`);
      assert.match(html, /"dateModified":"\d{4}-\d{2}-\d{2}"/, `${d.slug} has no dateModified`);
      assert.ok(html.length > 8000, `${d.slug} is ${html.length} bytes — still a thin page`);
      // The FAQ text has to be VISIBLE, not only in JSON-LD.
      const visible = html.replace(/<script[\s\S]*?<\/script>/g, '');
      assert.ok(visible.includes(d.faqs[0][0]), `${d.slug}'s first FAQ is only in JSON-LD`);
    }
  });

  it('no built area page names a hidden gem', () => {
    // All 30, not just the six — the town pages are generated too.
    const bad = [];
    for (const f of readdirSync(DIR)) {
      if (!f.endsWith('.html')) continue;
      const html = readFileSync(new URL(f, DIR), 'utf8');
      const hit = gemNames.filter(n => html.includes(n));
      if (hit.length) bad.push(`${f}: ${hit.slice(0, 3).join(', ')}`);
    }
    assert.deepEqual(bad, [], `gem names published: ${bad.join(' | ')}`);
  });

  it('the 24 town pages were left alone', () => {
    // This change must not touch what was already ranking. PR #194 records a
    // town page ranking first for a non-branded query.
    const towns = readdirSync(DIR).filter(f => f.endsWith('.html'))
      .map(f => f.replace('.html', ''))
      .filter(s => !DESTINATIONS.some(d => d.slug === s));
    assert.equal(towns.length, 24, `${towns.length} town pages — expected 24`);
    for (const t of towns) {
      const html = readFileSync(new URL(`${t}.html`, DIR), 'utf8');
      assert.ok(!html.includes('id="pe-destination"'), `${t} was given a destination block`);
    }
  });
}

console.log(`\n  ${passed} checks passed\n`);
