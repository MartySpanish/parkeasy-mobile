// The locked-gem funnel could never show a drop, because its first two steps
// were the same tap.
//
// WHAT THE ADMIN DASHBOARD SAID:
//
//     Saw a locked gem        gem_locked_view
//     Opened the paywall      premium_paywall_view
//     Paid                    premium_paid
//
// WHAT THE CODE DOES. All three locked surfaces are one button:
//
//     onClick={() => { track('gem_locked_view', { surface: 'card' }); onUpgrade(); }}
//
// `onUpgrade()` opens the pricing modal, which fires premium_paywall_view. So
// the two top steps fire on the SAME TAP, one after the other. Step one was
// never an impression — it was the click that produced step two.
//
// WHY IT MATTERED. The paywall was opened 3 times in three weeks and the
// question was whether that is a PRICE problem or an EXPOSURE problem. The one
// funnel that should answer it showed 3 → 3 → 0: a 100% step-one conversion by
// construction, and the number anybody would actually want — how many people
// saw a locked gem and did not tap — was collected nowhere.
//
// THE NAME IS THE OTHER HALF OF THE FIX. 'gem_locked_rendered', not '_seen' or
// '_impression': the client fires it when locked cards are painted into the
// list, and a card below the fold is painted and unread. Claiming "seen" would
// be the same class of error as the one being fixed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
/** Source with // comments stripped: a regex must match code, not a note. */
const code = (p) => read(p).split('\n').filter(l => !/^\s*(\/\/|--)/.test(l)).join('\n');

const app = read('../../src/App.jsx');
const appCode = app.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');
const analytics = code('../../src/analytics.js');
const mig = code('../../supabase/migrations/20261008_gem_impressions.sql');
const ingest = code('../../supabase/migrations/20260902_app_events_ingest.sql');

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };

console.log('\ngemImpressions — a funnel that can show a drop');

// ── The two allowlists ───────────────────────────────────────────────────────
it('the new event is in BOTH allowlists', () => {
  // src/analytics.js says it outright: "Both lists must be changed together —
  // the migration is the one that decides." log_app_event() returns false for
  // an unknown name, so a client-only addition is an event that is fired,
  // refused, and never recorded — silently.
  assert.match(analytics, /'gem_locked_rendered'/,
    'the client allowlist does not know the event, so track() drops it in dev');
  assert.match(mig, /'gem_locked_rendered'/,
    'the migration does not add the event to log_app_event, so the server refuses it');
});

it('the migration reproduces the whole allowlist, not a fragment of it', () => {
  // `allowed` is a local constant inside the function body, so the function has
  // to be replaced entire. Dropping a name while doing that would silently
  // stop an existing event — the worst possible way to add one.
  const names = (s) => {
    const m = s.match(/allowed constant text\[\] := array\[([\s\S]*?)\];/);
    assert.ok(m, 'no allowlist found');
    return new Set([...m[1].matchAll(/'([a-z_]+)'/g)].map(x => x[1]));
  };
  const before = names(ingest);
  const after = names(mig);
  const lost = [...before].filter(n => !after.has(n));
  assert.deepEqual(lost, [], `the migration drops existing event(s): ${lost.join(', ')}`);
  const added = [...after].filter(n => !before.has(n));
  assert.deepEqual(added, ['gem_locked_rendered'],
    `the migration adds more than the one event: ${added.join(', ')}`);
});

it('the client allowlist still matches the server one, name for name', () => {
  // The two lists drifting is how an event becomes unrecordable without
  // anything saying so. Compared as sets, both ways.
  const server = new Set([...mig.match(/allowed constant text\[\] := array\[([\s\S]*?)\];/)[1]
    .matchAll(/'([a-z_]+)'/g)].map(x => x[1]));
  const client = new Set([...analytics.match(/const KNOWN = new Set\(\[([\s\S]*?)\]\);/)[1]
    .matchAll(/'([a-z_]+)'/g)].map(x => x[1]));
  assert.deepEqual([...client].filter(n => !server.has(n)), [],
    'the client fires an event the server will refuse');
  assert.deepEqual([...server].filter(n => !client.has(n)), [],
    'the server accepts an event no client fires — one of the two lists moved alone');
});

// ── The funnel RPC ───────────────────────────────────────────────────────────
it('the summary RPC returns the new step, and keeps the old three', () => {
  for (const k of ['gem_locked_rendered', 'gem_locked_view',
                   'premium_paywall_view', 'premium_paid']) {
    assert.ok(mig.includes(`'${k}',`), `premium_funnel no longer returns ${k}`);
  }
  // The impression step must come FIRST in the object, so the dashboard reads
  // top-down in the order the driver actually moves.
  const i = mig.indexOf("'gem_locked_rendered',");
  const j = mig.indexOf("'gem_locked_view',      (select count");
  assert.ok(i !== -1 && j !== -1 && i < j, 'the impression step is not the first one');
  // Counted by distinct session, like every other step — not raw rows, which
  // would make one person scrolling a list look like a hundred.
  assert.match(mig, /'gem_locked_rendered',\s+\(select count\(distinct session_id\)/,
    'the impression step counts rows rather than sessions');
});

it('the migration is one transaction and nothing is left granted to anon', () => {
  assert.match(mig, /^begin;/m, 'no begin');
  assert.match(mig, /^commit;/m, 'no commit');
  // app_events_summary is the whole book of business. It was service_role only
  // before this and must stay that way.
  assert.match(mig, /revoke all on function public\.app_events_summary\(integer\) from public, anon, authenticated;/,
    'app_events_summary is no longer revoked from anon');
  assert.match(mig, /grant execute on function public\.app_events_summary\(integer\) to service_role;/,
    'app_events_summary is no longer granted to service_role');
  // log_app_event is the opposite: anon has to be able to call it.
  assert.match(mig, /grant execute on function public\.log_app_event\([^)]*\)\s*\n\s*to anon, authenticated;/,
    'log_app_event is no longer callable by a driver');
});

// ── The client fires it, once ────────────────────────────────────────────────
it('the impression is fired once per session, from the results list', () => {
  assert.match(appCode, /trackOnce\('gem_locked', 'gem_locked_rendered',/,
    'the impression is not fired, or not through trackOnce');
  assert.match(appCode, /if \(hiddenCount <= 0\) return;/,
    'the impression fires on a list with no locked gems in it');
  // Surface, so the list and the map can be told apart — gem_locked_view
  // already carries one and the two have to be comparable.
  assert.match(appCode, /surface: mode === 'map' \? 'map' : 'list'/,
    'the impression does not record which surface it was on');
  // And the count, so "how many were on the page" is answerable, not just
  // "was there one".
  assert.match(appCode, /n: String\(hiddenCount\)/,
    'the impression does not carry how many locked gems were on the page');
});

it('trackOnce is genuinely once, with a per-key marker', () => {
  assert.match(analytics, /export const trackOnce = \(key, name, props = \{\}, opts = \{\}\) => \{/,
    'trackOnce is gone');
  assert.match(analytics, /if \(onceFired\.has\(key\)\) return;/,
    'the module-level guard is gone — private mode would fire on every render');
  // PER KEY. A single shared marker would let two once-per-session events
  // consume each other's only chance, which is the bug the attribution
  // one-shot had when it sat above the throttle.
  assert.match(analytics, /const marker = `pe_once_\$\{key\}`;/,
    'the storage marker is not keyed, so two once-events collide');
  assert.ok(!/localStorage\.getItem\('pe_once'\)/.test(analytics),
    'a single shared once-marker is back');
  // Storage failing must not drop the event.
  assert.match(analytics, /\} catch \{ \/\* private mode: once per page load is the honest best \*\/ \}\n\s*track\(name, props, opts\);/,
    'a storage failure now swallows the event instead of firing it');
});

it('the impression event is not throttled into uselessness', () => {
  // map_move is throttled to one every two seconds. An event that fires once
  // per session must not be, or the one chance could be the one dropped — the
  // exact ordering bug the attribution one-shot had.
  const m = analytics.match(/const THROTTLE_MS = \{([^}]*)\}/);
  assert.ok(m, 'the throttle table is gone');
  assert.ok(!/gem_locked_rendered/.test(m[1]),
    'the once-per-session impression is also throttled');
});

// ── The dashboard no longer mislabels the tap ────────────────────────────────
it('the funnel labels say what each step is', () => {
  assert.ok(!/\['Saw a locked gem', pf\.gem_locked_view/.test(appCode),
    'the dashboard still calls the TAP "Saw a locked gem"');
  assert.match(appCode, /\['Locked gem on the page', pf\.gem_locked_rendered \|\| 0\],/,
    'the impression step is not on the dashboard');
  assert.match(appCode, /\['Tapped a locked gem', pf\.gem_locked_view \|\| 0\],/,
    'the tap step is missing, or is labelled as something other than a tap');
  // All four steps, in order — WITHIN THIS FUNNEL'S OWN BLOCK. Searching the
  // whole file found 'Paid' in an unrelated place 300kB earlier and reported
  // the order as wrong; the block is what has an order.
  const block = appCode.match(/<Funnel title="Locked gem → Premium" steps=\{\[([\s\S]*?)\]\}\/>/);
  assert.ok(block, 'the Locked gem → Premium funnel is gone');
  const labels = [...block[1].matchAll(/\['([^']+)',/g)].map(m => m[1]);
  assert.deepEqual(labels,
    ['Locked gem on the page', 'Tapped a locked gem', 'Opened the paywall', 'Paid'],
    'the funnel steps are missing or out of order');
});

// ── The offer on the locked card ─────────────────────────────────────────────
// ── All four locked surfaces, not just the one ───────────────────────────────
// THE MUTATION HARNESS FOUND THIS. A mutation aimed at the locked card's copy
// reported its anchor matching TWICE, which is how it came out that there are
// FOUR locked surfaces — SpotCard, ListCard, RowItem and the map popup — built
// as four near-identical hand-written blocks. The duplication had already cost
// two things nobody had noticed:
//
//   · ListCard's locked state fired NO event at all (`onClick={onUpgrade}`),
//     so even the tap count was short by a whole surface;
//   · three of the four quoted no price.
//
// The first version of the fix priced one surface and tested one surface. So
// the shared parts are now shared, and these assertions count call sites.
const SURFACES = ['card', 'list', 'row', 'map'];

it('every locked surface is a locked surface: four, no more, no fewer', () => {
  // gatedLabel() is the title every locked surface renders, so counting it
  // counts the surfaces — including a fifth one added later without a price.
  const labels = (appCode.match(/gatedLabel\(/g) || []).length;
  assert.equal(labels, SURFACES.length,
    `${labels} locked surfaces render gatedLabel but ${SURFACES.length} are accounted for below `
    + '— a new one has been added, or one has gone');
});

it('all four fire the tap event, each naming its own surface', () => {
  // ListCard fired nothing. A locked surface that opens the paywall without
  // recording the tap makes the funnel short by a whole surface.
  const calls = [...appCode.matchAll(/onGemLock\('([a-z]+)', onUpgrade\)/g)].map(m => m[1]);
  assert.deepEqual([...calls].sort(), [...SURFACES].sort(),
    `the tap handlers cover ${calls.join(', ')} — every locked surface needs its own`);
  assert.equal(new Set(calls).size, calls.length, 'two surfaces report the same name');
  // The handler must do BOTH things. Mutation: drop either and a tap is
  // unrecorded, or the paywall never opens.
  assert.match(appCode, /const onGemLock = \(surface, onUpgrade\) => \(\) => \{\s*\n\s*track\('gem_locked_view', \{ surface \}\);\s*\n\s*onUpgrade\?\.\(\);/,
    'onGemLock no longer both records the tap and opens the paywall');
  // And no surface may hand-roll it again.
  assert.ok(!/onClick=\{\(\) => \{ track\('gem_locked_view'/.test(appCode),
    'a locked surface hand-rolls the tap handler again — that is how one came to fire nothing');
});

it('all four quote the price, from the shared constant', () => {
  const prices = (appCode.match(/<GemPrice/g) || []).length;
  assert.equal(prices, SURFACES.length,
    `${prices} of ${SURFACES.length} locked surfaces quote a price`);
  assert.match(appCode, /<p className=\{className\}>Premium from \{PREMIUM_ANNUAL_GBP\}\/yr<\/p>/,
    'GemPrice no longer reads the shared constant');
  // Never typed: four surfaces must not quote four prices.
  assert.ok(!/Premium from £\d/.test(appCode), 'a price is hardcoded on a locked surface');
  assert.match(app, /const PREMIUM_ANNUAL_GBP\s+= '£\d+'/, 'the price constant moved');
  // Same phrasing the upgrade banner already uses.
  assert.match(appCode, /Upgrade to Premium — from \{PREMIUM_ANNUAL_GBP\}\/yr/,
    'the banner and the cards no longer use the same phrasing');
});

it('every locked surface says the parking itself is free', () => {
  // The gem is free to park in; Premium buys the exact location. Dropping that
  // turns a £29 subscription into something that looks like a parking charge.
  // RowItem said only "unlock the exact spot", which omitted it entirely.
  const said = (appCode.match(/free to park, exact spot with Premium/g) || []).length;
  assert.equal(said, 3,
    `${said} of the 3 text surfaces say the parking is free (the map popup says it in its own words)`);
  // The map popup's wording, which has to carry the same fact.
  assert.match(appCode, /the exact free spot is revealed with Premium/,
    'the map popup no longer says the spot itself is free');
  assert.ok(!/— unlock the exact spot</.test(appCode),
    'a locked surface is back to copy that never says the parking is free');
});

// ── The docs ─────────────────────────────────────────────────────────────────
it('docs/premium.md records the defect and that the migration must be applied', () => {
  const docs = readFileSync(new URL('../../docs/premium.md', import.meta.url), 'utf8');
  assert.match(docs, /gem_locked_rendered/, 'the new event is undocumented');
  assert.match(docs, /same tap/,
    'the docs do not record that the two steps fired on the same tap');
  // The deploy step is the half that is easy to lose: until the migration is
  // applied the event is refused and nothing is recorded.
  assert.match(docs, /20261008_gem_impressions\.sql/,
    'the docs do not name the migration that has to be applied');
  assert.match(docs, /returns `false` for an unknown name/,
    'the docs do not say what happens before the migration is applied');
  assert.match(docs, /ListCard/, 'the docs do not record the surface that fired nothing');
});

console.log(`\n  ${passed} checks passed\n`);
