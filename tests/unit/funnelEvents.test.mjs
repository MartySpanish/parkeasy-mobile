// The funnel events, and the two routes that quietly counted nothing.
//
// THE DEFECT. openSpot() in src/App.jsx is the one place a spot open is
// recorded — it fires listing_view for a bookable listing and gem_view for a
// free spot. Its own comment said:
//
//   "Every route into the spot sheet goes through here — list tap, map pin,
//    event overlay, partner card, deep link — so the open is counted once and
//    in one place."
//
// TWO OF THOSE ROUTES DID NOT. The events overlay and the Saved tab were handed
// `setDetailSpot` directly, so opening a spot from either set the sheet and
// fired nothing at all. The Saved tab is where a returning driver goes and the
// events overlay is the matchday path — the two least-visible routes were the
// two that counted nothing, and the funnel reading "nobody opens a listing"
// was partly this.
//
// Nothing errored. The sheet opened correctly. The only symptom was a number
// that was too low, on the dashboard that decides what to build next.
//
// WHY THE CHECK IS STRUCTURAL. A comment cannot enforce itself, and the comment
// was wrong for a whole release. So this file classifies EVERY setDetailSpot
// reference in App.jsx: a close may use it, an open may not. A third route
// added later with the same shortcut fails the suite.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const app = read('../../src/App.jsx');
/** Source with comments stripped: a regex must match code, not a note about it. */
const appCode = app.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');
const analytics = read('../../src/analytics.js');

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };

console.log('\nfunnelEvents — every route into the sheet is counted');

// ── The structural guard ─────────────────────────────────────────────────────
it('no route opens the spot sheet without going through openSpot', () => {
  // THE DEFECT, as a rule. Every line mentioning setDetailSpot must be either a
  // close, the declaration, or the one assignment inside openSpot itself.
  const lines = appCode.split('\n')
    .map((text, i) => ({ n: i + 1, text }))
    .filter(l => l.text.includes('setDetailSpot'));
  assert.ok(lines.length >= 4, `only ${lines.length} setDetailSpot references — did it get renamed?`);
  const bad = lines.filter(l =>
    !/setDetailSpot\(null\)/.test(l.text)          // closing the sheet
    && !/useState\(null\)/.test(l.text)            // the declaration
    && !/^\s*setDetailSpot\(sp\);\s*$/.test(l.text) // the one line inside openSpot
  );
  assert.deepEqual(bad.map(l => `line ${l.n}: ${l.text.trim().slice(0, 80)}`), [],
    'a route sets the spot sheet without going through openSpot, so the open fires '
    + 'no listing_view and no gem_view');
});

it('the two routes that were broken now use openSpot', () => {
  // Named explicitly as well as caught structurally, because these two are the
  // bug rather than an example of it.
  assert.match(appCode, /onUpgrade=\{\(\)=>\{setShowEvents\(false\);setShowPricing\(true\);\}\} onOpen=\{openSpot\}\/>/,
    'the events overlay no longer counts a spot open');
  // `[\s\S]*?` not `[^>]*` — the props in between contain `()=>`, and a `>`
  // terminates a negated-bracket class, so the first version of this never
  // matched and failed on a correct file.
  assert.match(appCode, /<SavedTab [\s\S]*?onOpenSpot=\{openSpot\}\/>/,
    'the Saved tab no longer counts a spot open');
  assert.ok(!/<SavedTab [\s\S]*?onOpenSpot=\{setDetailSpot\}/.test(appCode),
    'the Saved tab is back to bypassing openSpot');
});

it('openSpot still fires the event, and picks the right one', () => {
  assert.match(appCode, /track\(sp\.rental \? 'listing_view' : 'gem_view',/,
    'openSpot no longer records the open, or no longer tells a listing from a gem');
  // A close must not be counted as an open.
  assert.match(appCode, /const openSpot = useCallback\(\(sp\) => \{\s*\n\s*if \(sp\) \{/,
    'openSpot no longer guards on there being a spot — closing would fire listing_view');
  // The listing id rides along, which is what makes the event joinable to a
  // booking later. Without it the funnel cannot connect a view to a sale.
  assert.match(appCode, /\{ listingId: sp\.listing\?\.id \|\| null, town: sp\.town \|\| null \}/,
    'the open no longer carries the listing id, so a view cannot be joined to a booking');
});

// ── The whole funnel, end to end ─────────────────────────────────────────────
it('every step of the booking funnel has an emitter somewhere in src/', () => {
  // The audit found three funnel events that were allowlisted, returned by the
  // summary RPC, and shown on the admin dashboard with nothing firing them.
  // This is the sweep that would have caught that.
  //
  // SCANNED FOR A VARIABLE NAME TOO. listing_view and gem_view are emitted by a
  // TERNARY — track(sp.rental ? 'listing_view' : 'gem_view', …) — and a scan for
  // track('<literal>') alone reports them as having no emitter at all, which is
  // exactly the false alarm this comment exists to stop.
  const files = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = `${d}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (/\.(js|jsx)$/.test(e.name)) files.push(p);
    }
  };
  walk(new URL('../../src', import.meta.url).pathname);
  const src = files.map(f => readFileSync(f, 'utf8')).join('\n');
  const emitted = new Set();
  for (const m of src.matchAll(/\btrack(?:Once)?\(\s*'([a-z_]+)'(?:\s*,\s*'([a-z_]+)')?/g)) {
    emitted.add(m[1]); if (m[2]) emitted.add(m[2]);
  }
  // Names inside a ternary or passed as a variable.
  for (const m of src.matchAll(/'([a-z_]+)'\s*:\s*'([a-z_]+)'/g)) { emitted.add(m[1]); emitted.add(m[2]); }
  for (const m of src.matchAll(/\?\s*'([a-z_]+)'\s*:\s*'([a-z_]+)'/g)) { emitted.add(m[1]); emitted.add(m[2]); }

  const FUNNEL = ['search', 'listing_view', 'booking_start', 'booking_paid',
                  'gem_view', 'gem_locked_rendered', 'gem_locked_view',
                  'premium_paywall_view', 'premium_paid'];
  const dead = FUNNEL.filter(n => !emitted.has(n));
  assert.deepEqual(dead, [],
    `funnel step(s) with no emitter anywhere in src/: ${dead.join(', ')} — the dashboard `
    + 'will show a flat line for a feature that works');
});

it('every funnel step the dashboard shows is one the client can send', () => {
  // The other direction: a step on the admin funnel that is not on the client
  // allowlist is a row that can only ever read zero.
  const known = new Set([...analytics.match(/const KNOWN = new Set\(\[([\s\S]*?)\]\);/)[1]
    .matchAll(/'([a-z_]+)'/g)].map(m => m[1]));
  for (const block of appCode.matchAll(/<Funnel title="[^"]*" steps=\{\[([\s\S]*?)\]\}\/>/g)) {
    for (const step of block[1].matchAll(/pf\.([a-z_]+)|bf\.([a-z_]+)/g)) {
      const name = step[1] || step[2];
      assert.ok(known.has(name),
        `the admin funnel shows "${name}", which is not on the client allowlist — it can only read zero`);
    }
  }
});

console.log(`\n  ${passed} checks passed\n`);
