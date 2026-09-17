// One number, one source.
//
// The homepage quotes three figures — total spots, hidden gems, EV chargers —
// in five places: the meta description, the og: and twitter: descriptions, and
// the prerendered body. They were typed into index.html and into
// scripts/prerender.mjs, with a comment asking whoever changed the data to
// update them by hand. Nobody did. Google was told 741 spots and 88 gems while
// the app held 744 and 89, and it took the globe card printing the real
// figures on the SAME PAGE for anyone to notice.
//
// So the numbers now derive from public/globe/places.json, which
// scripts/generate-globe-data.mjs writes from the spot modules earlier in the
// same `npm run build`. These checks fail if anyone types one back in, and if
// the shipped page ever quotes two different totals for one thing.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const prerender = read('../../scripts/prerender.mjs');
const generator = read('../../scripts/generate-globe-data.mjs');
const indexHtml = read('../../index.html');
const pkg = JSON.parse(read('../../package.json'));

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };

console.log('\nnetworkCounts — the page cannot quote two totals for one thing');

it('prerender reads the counts instead of carrying its own', () => {
  assert.match(prerender, /readFileSync\(\s*'public\/globe\/places\.json'/,
    'prerender no longer reads public/globe/places.json');
  assert.match(prerender, /NETWORK = \{[^}]*places\.stats\.spaces[^}]*places\.stats\.gems[^}]*places\.stats\.ev[^}]*\}/,
    'NETWORK is no longer built from the generated stats block');
  // The exact shape that caused the drift: a literal on the right of the key.
  const typed = prerender.match(/\b(spots|gems|ev)\s*:\s*\d+/);
  assert.equal(typed, null, `a count is typed into prerender again: ${typed?.[0]}`);
});

it('prerender refuses to run on a missing or malformed stats block', () => {
  assert.match(prerender, /Number\.isInteger\(v\)/,
    'the guard on the derived counts is gone — a missing stats block would fall through silently');
  assert.match(prerender, /throw new Error\(`prerender: \$\{k\} is \$\{v\}/,
    'prerender no longer throws when a count is absent');
});

it('the generator derives the EV count rather than trusting a module length', () => {
  assert.match(generator, /ev:\s*all\.filter\(s => s\.ev\?\.available\)\.length/,
    'the EV count is no longer derived from the spot data');
  // EV_SPOTS.length is 197; the real answer counts chargers recorded on spots
  // in all five modules. Reading a length here would understate it by ten.
  assert.ok(!/ev:\s*EV_SPOTS\.length/.test(generator),
    'the EV count reads EV_SPOTS.length, which misses chargers on other modules');
});

it('the build derives the counts before it uses them', () => {
  const i = pkg.scripts.build.indexOf('generate-globe-data.mjs');
  const j = pkg.scripts.build.indexOf('prerender.mjs');
  assert.ok(i >= 0 && j >= 0, 'the build no longer runs both scripts');
  assert.ok(i < j, 'prerender now runs before the generator — it would read stale or absent stats');
});

it('the meta descriptions hold tokens, not numbers', () => {
  for (const token of ['{{SPOTS}}', '{{GEMS}}', '{{EV}}']) {
    assert.ok(indexHtml.includes(token), `index.html no longer contains ${token}`);
  }
  // Any bare number left in a description is a count someone typed back in.
  // Scoped to the description tags: og:image:width is a number and always will be.
  const descriptions = [...indexHtml.matchAll(/<meta[^>]*description"[^>]*content="([^"]*)"/g)];
  assert.equal(descriptions.length, 3,
    `expected 3 description tags in index.html, found ${descriptions.length}`);
  for (const [, content] of descriptions) {
    const stray = content.match(/\b\d+\b/);
    assert.equal(stray, null,
      `a count is typed into a description tag again (${stray?.[0]}): ${content.slice(0, 80)}…`);
  }
});

it('prerender fills every token and shouts about any it misses', () => {
  for (const token of ['{{SPOTS}}', '{{GEMS}}', '{{EV}}']) {
    assert.ok(prerender.includes(`replaceAll('${token}'`),
      `prerender does not substitute ${token} — it would ship braces to Google`);
  }
  assert.match(prerender, /unsubstituted token/,
    'the leftover-token guard is gone: a new token would reach a search result as {{NAME}}');
});

// ── The built output, when there is one ─────────────────────────────────────
const distUrl = new URL('../../dist/index.html', import.meta.url);
if (existsSync(distUrl)) {
  const dist  = readFileSync(distUrl, 'utf8');
  const stats = JSON.parse(read('../../public/globe/places.json')).stats;

  it('the shipped page quotes the real figures, and only those', () => {
    assert.equal(dist.match(/\{\{[A-Z_]+\}\}/g), null, 'an unsubstituted token shipped in dist/index.html');

    // Every count the page states, wherever it states it, against the source.
    const quoted = [
      ...dist.matchAll(/(\d[\d,]*)\s+(?:parking spots|mapped spots)/g),
      ...dist.matchAll(/(\d[\d,]*)\s+hidden gems/g),
      ...dist.matchAll(/(\d[\d,]*)\s+EV chargers/g),
    ];
    assert.ok(quoted.length >= 5, `only ${quoted.length} counts found in dist — the SEO block may not have injected`);

    const allowed = new Set([stats.spaces, stats.gems, stats.ev]);
    for (const [text, n] of quoted) {
      assert.ok(allowed.has(Number(n.replace(/,/g, ''))),
        `dist/index.html says "${text}" but the data holds ${stats.spaces} spots / `
        + `${stats.gems} gems / ${stats.ev} EV`);
    }
  });
} else {
  console.log('  SKIP  built-output checks (no dist/ — run `npm run build` first)');
}

console.log(`\n  ${passed} checks passed\n`);
