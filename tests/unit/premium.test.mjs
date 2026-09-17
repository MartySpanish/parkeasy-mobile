// A paywall that sells things that exist.
//
// The pricing sheet listed six benefits as hardcoded strings, and two of them
// were not true:
//
//   "🗺️ Offline maps — works without signal" — there were none. public/sw.js
//   said `if (!isAppShell) return; // OSM tiles, fonts, etc. pass through
//   normally`, so with no signal the map drew nothing at all. People paid £29 a
//   year partly for this.
//
//   "🔔 Notifications when spots free up" — this one exists, and is free to
//   everybody who leaves an email. Charging for it is a different untruth from
//   inventing it, and not much better.
//
// So the rule this suite holds is: every claim on the paywall names the thing
// in this repository that implements it, and that thing is there.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PREMIUM_BENEFITS, paidBenefits, freeBenefits } from '../../src/premium.js';

const raw = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const cut = (p) => raw(p)
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/^\s*\/\*[\s\S]*?\*\//gm, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const app = cut('../../src/App.jsx');
const sw  = cut('../../public/sw.js');
const off = cut('../../src/offlineMaps.js');

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };

console.log('\npremium — the paywall only sells what is built');

//------------------------------------------------------- every claim has a proof
it('every benefit names code that exists, and the code is there', () => {
  assert.ok(PREMIUM_BENEFITS.length >= 5, 'the benefit list has been gutted');
  for (const b of PREMIUM_BENEFITS) {
    assert.ok(b.proof?.file && b.proof?.needle, `"${b.text}" has no proof attached`);
    // Read WITHOUT stripping comments, because a proof may legitimately point
    // at a constant; but the needle must not be satisfied by prose about it.
    const body = cut(`../../${b.proof.file}`);
    assert.ok(body.includes(b.proof.needle),
      `the paywall sells "${b.text}" and ${b.proof.file} contains no ${b.proof.needle} — `
      + 'either build it or stop selling it');
    assert.ok(['premium', 'everyone'].includes(b.tier), `"${b.text}" has no tier`);
  }
});

it('nothing free is sold as Premium', () => {
  // The waitlist notification is real and free. It stays on the sheet, under
  // its own heading, described as free — which is worth more than pretending it
  // is a perk.
  const free = freeBenefits();
  assert.ok(free.length >= 1, 'the free-for-everyone section is gone');
  for (const b of free) {
    assert.match(b.text, /free for everyone/i,
      `"${b.text}" is free and the sheet does not say so`);
  }
  for (const b of paidBenefits()) {
    assert.ok(!/free for everyone/i.test(b.text), `"${b.text}" is in both lists`);
  }
  // And both sections are actually rendered — a source of truth nothing reads
  // is a comment.
  assert.match(app, /\{paidBenefits\(\)\.map\(b=>\(/, 'the paid list is not rendered');
  assert.match(app, /\{freeBenefits\(\)\.map\(b=>\(/, 'the free list is not rendered');
  assert.match(app, /Free for everyone/, 'the free section has no heading');
  // The old hardcoded array is gone, or there are two lists to keep in step.
  assert.ok(!/\['🗺️','Offline maps/.test(app), 'the hardcoded benefit array is back');
  assert.ok(!/Offline maps — works without signal/.test(raw('../../src/App.jsx')),
    'the claim that it works without signal anywhere is back');
});

it('no benefit promises more than it does', () => {
  const offline = PREMIUM_BENEFITS.find(b => b.proof.file === 'public/sw.js');
  assert.ok(offline, 'the offline-maps benefit is gone');
  // "Works without signal" is a promise about a place the driver has never
  // opened. What is built caches the tiles they looked at, and the sentence
  // has to say so or it is the same lie in a new shape.
  assert.ok(!/works without signal/i.test(offline.text), offline.text);
  assert.match(offline.text, /looked at/, offline.text);
  for (const b of PREMIUM_BENEFITS) {
    assert.ok(!/\ball of\b|\banywhere\b|\bwhole country\b|unlimited/i.test(b.text),
      `"${b.text}" claims coverage nothing can deliver`);
  }
});

//---------------------------------------------------------- the tiles, for real
it('tiles are cached, which is the thing that was missing', () => {
  // The line this replaces returned early for EVERY cross-origin request, so
  // the property to assert is the ordering: tiles are handled before that
  // bail-out. Asserted on the stripped source — the first version of this check
  // searched the raw file for the old comment's wording and fired on the new
  // comment quoting it, which is the seventh time a check in this repo has
  // passed on its own prose.
  assert.ok(sw.indexOf('isTile(url)') < sw.indexOf('const isAppShell'),
    'the worker bails out on cross-origin before it looks at tiles — there are no offline maps');
  assert.match(sw, /if \(!isAppShell\) return;/, 'the app-shell branch is gone entirely');
  assert.match(sw, /const TILE_CACHE = 'parkeasy-tiles-v\d+';/, 'the tile cache is gone');
  assert.match(sw, /if \(isTile\(url\)\) \{/, 'tile requests are no longer recognised');
  // Both providers, because which one is in use depends on VITE_CARTO_API_KEY
  // (see src/mapTiles.js) and caching only one means half the deployments have
  // no offline maps at all.
  assert.match(sw, /tile\\\.openstreetmap\\\.org/, 'OSM tiles are not cached');
  assert.match(sw, /basemaps\\\.cartocdn\\\.com/, 'CARTO tiles are not cached');
});

it('a tile is served from the cache first, and the network never breaks it', () => {
  const fn = sw.slice(sw.indexOf('async function tileResponse'), sw.indexOf('let trimming'));
  assert.ok(fn.length > 200, 'tileResponse is gone');
  // Cache first is right for exactly this one thing: a tile at a given z/x/y
  // is immutable, so a stored copy is not staleness.
  assert.ok(fn.indexOf('cache.match(request)') < fn.indexOf('await fetch(request)'),
    'the network is tried before the cache — offline maps that need the network');
  // A background refresh that rejects must not surface: the driver has their
  // tile already.
  assert.match(fn, /fetch\(request\)\.then\([\s\S]{0,140}?\)\.catch\(\(\) => \{\}\)/,
    'a failed background refresh now rejects in the driver’s face');
  // An opaque response IS what a no-CORS tile fetch returns. Checking r.ok
  // alone rejects every one of them and caches nothing.
  assert.match(fn, /r\.ok \|\| r\.type === 'opaque'/,
    'only r.ok is checked, so no tile is ever actually stored');
  // And with no signal and nothing stored, Leaflet gets its failure rather than
  // an exception from inside the worker.
  assert.match(fn, /catch \(e\) \{[\s\S]{0,300}?throw e;/, 'a total miss is swallowed');
});

it('the cache is capped, and the cap cannot run away with itself', () => {
  assert.match(sw, /const TILE_LIMIT = (\d+);/, 'the tile cache is unbounded');
  const limit = Number(sw.match(/const TILE_LIMIT = (\d+);/)[1]);
  assert.ok(limit >= 200 && limit <= 5000,
    `${limit} tiles is either not worth having or too much for a phone`);
  const trim = sw.slice(sw.indexOf('async function trimTiles'), sw.indexOf("self.addEventListener('message'"));
  assert.match(trim, /if \(trimming\) return;/,
    'two tile fetches can trim at once and delete twice as much');
  assert.match(trim, /finally \{ trimming = false; \}/,
    'a failed trim leaves the guard set and nothing is ever trimmed again');
  assert.match(trim, /keys\.slice\(0, over\)/, 'the newest tiles are deleted instead of the oldest');
});

it('a deploy does not throw away the driver’s stored map', () => {
  // The activate handler deletes every cache but the current one, which is
  // right for the app shell and would wipe the map on every single ship.
  const act = sw.slice(sw.indexOf("addEventListener('activate'"), sw.indexOf("addEventListener('fetch'"));
  assert.match(act, /k !== CACHE && k !== TILE_CACHE/,
    'the tile cache is deleted on every deploy, so offline maps last until the next ship');
});

//------------------------------------------------------------- who gets them
it('the worker caches nothing until the page says the driver is entitled', () => {
  assert.match(sw, /let tilesOn = false;/,
    'tile caching defaults to on, so the free tier gets the paid feature');
  assert.match(sw, /if \(tilesOn\) e\.respondWith\(tileResponse\(e\.request\)\);/,
    'entitlement is no longer checked before caching');
  assert.match(sw, /if \(d\.type === 'offline-maps'\) tilesOn = Boolean\(d\.on\);/,
    'the worker cannot be told');
  // The worker has no way to check for itself: Premium lives behind the
  // Supabase anon key, which is in the app bundle and not in the worker.
  assert.ok(!/supabase|promo_redemptions|has_premium/i.test(sw),
    'the worker is trying to check entitlement itself');
});

it('entitlement is re-posted on every load, not set once', () => {
  // tilesOn is a variable in memory. The browser stops and restarts a worker
  // whenever it likes, and it comes back false.
  assert.match(app, /if \(isPremium\) setOfflineMaps\(true\);/, 'the worker is never told');
  // Read from the effect itself. App.jsx has other effects keyed on
  // [isPremium] and a bare search for one was satisfied by those.
  const eff = app.slice(app.indexOf('if (isPremium) setOfflineMaps(true);'));
  assert.match(eff.slice(0, 300), /\}, \[isPremium\]\);/,
    'the message is not re-sent when entitlement changes');
  assert.match(off, /sw\?\.controller/, 'the controlling worker is not messaged');
  // On the very first load there is no controller yet — the worker is still
  // installing — so ready is used as well.
  assert.match(off, /sw\?\.ready\?\.then\(reg => reg\.active\?\.postMessage\(msg\)\)/,
    'the first load never reaches the worker');
  assert.match(off, /catch \{ return false; \}/,
    'a browser with no service worker now throws out of a render');
});

it('turning it off deletes what is stored', () => {
  // Otherwise a lapsed subscriber keeps fifty megabytes with no way to shift it
  // short of clearing site data.
  assert.match(app, /else \{ setOfflineMaps\(false\); clearOfflineMaps\(\); \}/,
    'switching off stops adding tiles but leaves the ones already there');
  assert.match(sw, /if \(d\.type === 'offline-maps-clear'\) \{[\s\S]{0,200}?caches\.delete\(TILE_CACHE\)/,
    'the worker cannot empty the tile cache');
  assert.match(sw, /caches\.delete\(TILE_CACHE\)\);\s*\n\s*tilesOn = false;/,
    'clearing leaves caching switched on, so it refills immediately');
  // And the driver can do it themselves.
  // toast(), not notify(). This check originally asserted notify(), which is
  // src/notify.js's email-the-founder function — the sentence went to an inbox
  // and the driver saw nothing. See src/toast.js and docs/matchday.md.
  assert.match(app, /clearOfflineMaps\(\); setOfflineMaps\(true\); toast\('Stored maps cleared'\)/,
    'there is no way for a subscriber to clear the stored map');
});

it('nothing but a GET is ever answered from a cache', () => {
  // A POST to Supabase or Stripe answered from a cache is a booking that did
  // not happen reported as one that did.
  assert.match(sw, /if \(e\.request\.method !== 'GET'\) return;/,
    'the worker will happily cache a POST');
  assert.ok(sw.indexOf("method !== 'GET'") < sw.indexOf('isTile(url)'),
    'the method is checked after the tile branch, which is the branch that caches');
});

console.log(`\n  ${passed} checks passed\n`);
