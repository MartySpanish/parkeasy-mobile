// Six places print "how big is ParkEasy". They must not answer differently.
//
// The count appears in the prerendered SEO text, the three meta descriptions,
// the globe card, the homepage hero, the welcome screen's four tiles and the
// admin dashboard's App data tiles. Every one of the last three counted the
// BUNDLED arrays — 744 spots, 89 gems — which is the fallback list the app uses
// only when the hidden_gems query fails. The live table holds 133 published
// gems, so the admin dashboard was telling Marty 89 while the app served 133.
//
// These checks hold the runtime surfaces to public/globe/places.json, which is
// the file the build writes and the only place the two are reconciled.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const app  = read('../../src/App.jsx');
const hook = read('../../src/useNetworkStats.js');

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };

console.log('\nnetworkStats — one source for "how big is ParkEasy"');

it('the admin dashboard reads the generated stats, not the bundled arrays', () => {
  assert.match(app, /const adminStats = useNetworkStats\(BUNDLED_STATS\)/,
    'the admin dashboard no longer uses the shared stats');
  for (const tile of ['Parking spots', 'Hidden gems', 'Towns covered']) {
    const m = app.match(new RegExp(`<Tile label="${tile}" value=\\{([^}]+)\\}`));
    assert.ok(m, `the "${tile}" tile is gone`);
    assert.match(m[1], /^adminStats\./,
      `the "${tile}" tile counts ${m[1]} again — that is the bundled fallback, not what the app serves`);
  }
});

it('the welcome screen tiles do too', () => {
  assert.match(app, /const welcomeNumbers = useNetworkStats\(BUNDLED_STATS\)/,
    'the welcome screen no longer uses the shared stats');
  assert.match(app, /welcomeStats\(welcomeNumbers\)\.map/,
    'the welcome tiles are back to a static array');
  // Car parks has no equivalent in the generated stats and stays bundled — but
  // it must be the ONLY one, or this whole check is decorative.
  assert.match(app, /\[WELCOME_CAR_PARKS, 'Car parks'/,
    'the car-park tile changed shape; check it is still the only bundled one');
  const live = app.match(/const welcomeStats = \(st\) => \[([\s\S]*?)\];/);
  assert.ok(live, 'welcomeStats no longer exists');
  assert.equal((live[1].match(/st\./g) || []).length, 3,
    'the welcome row no longer takes three of its four numbers from the live stats');
});

it('a stat tile is never blank, whatever happens to the file', () => {
  // These numbers sit inside sentences. An empty tile, or a confident-looking
  // zero, is worse than a slightly stale count.
  assert.match(hook, /return stats \|\| fallback \|\| null/,
    'the hook no longer falls back to the bundled counts');
  assert.match(hook, /\.catch\(\(\) => null\)/,
    'a failed fetch is no longer swallowed — offline would throw into a render');
  assert.match(hook, /Number\.isInteger\(s\.spaces\).*Number\.isInteger\(s\.gems\).*Number\.isInteger\(s\.towns\)/s,
    'the hook accepts a half-written stats block, which would render a zero');
});

it('however many components ask, the file is fetched once', () => {
  // The welcome screen and the admin dashboard can be mounted in the same
  // session; a per-component fetch would request the file twice for numbers
  // that cannot have changed between them.
  assert.match(hook, /let cached = null/, 'the resolved stats are no longer cached');
  assert.match(hook, /let inFlight = null/, 'concurrent callers no longer share one request');
  assert.match(hook, /if \(inFlight\) return inFlight/, 'a second caller starts its own fetch');
});

it('BUNDLED_STATS is derived, not typed', () => {
  const m = app.match(/const BUNDLED_STATS = \{([\s\S]*?)\};/);
  assert.ok(m, 'BUNDLED_STATS is gone');
  assert.ok(!/:\s*\d+/.test(m[1]),
    `a count is typed into BUNDLED_STATS: ${m[1].trim().slice(0, 60)}`);
  assert.match(m[1], /ALL_SPOTS_STATS\.length/, 'the fallback spot count is no longer counted');
});

console.log(`\n  ${passed} checks passed\n`);
