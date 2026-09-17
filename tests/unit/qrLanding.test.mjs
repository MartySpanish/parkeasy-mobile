// A printed sticker cannot be edited.
//
// That is the whole design constraint here. A QR code on a barber's wall points
// at /q/<code> forever, so every failure in this route still has to end in a
// redirect: an unknown code, an unreachable database, a missing lands_on. The
// scan being lost is a smaller problem than the person being lost.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const q      = read('../../api/q.js');
const vercel = JSON.parse(read('../../vercel.json'));
const app    = read('../../src/App.jsx');
const admin  = read('../../api/admin.js');

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };

console.log('\nqrLanding — a sticker on a wall cannot be edited');

it('the route exists at all, which is why there were zero scans', () => {
  const rw = (vercel.rewrites || []).find(r => r.source === '/q/:code');
  assert.ok(rw, '/q/:code is not routed — a scan falls through to the SPA and records nothing');
  assert.equal(rw.destination, '/api/q?code=:code');
  // It must come BEFORE the catch-all, or the catch-all swallows it.
  const idx = vercel.rewrites.findIndex(r => r.source === '/q/:code');
  const catchAll = vercel.rewrites.findIndex(r => r.source.includes('(?!api/)'));
  assert.ok(idx < catchAll, '/q/:code is routed after the SPA catch-all, which will swallow it');
});

it('every path out of the handler redirects', () => {
  // No code, no config, unknown code, thrown error — all four end in go().
  for (const guard of [
    /if \(!code \|\| !URL_ \|\| !SERVICE\) return go\(FALLBACK\)/,
    /if \(!row\) \{[\s\S]*?return go\(FALLBACK\)/,
    /catch \(e\) \{[\s\S]*?return go\(FALLBACK\)/,
  ]) {
    assert.match(q, guard, 'a failure path no longer ends in a redirect — a scan would dead-end');
  }
  assert.match(q, /return go\(row\.lands_on \|\| FALLBACK\)/,
    'a code with no lands_on no longer falls back');
});

it('the redirect is 302, never 301', () => {
  // A permanent redirect is cached by the browser, so every later scan of that
  // sticker skips this route entirely — the counting stops and nobody knows why.
  assert.match(q, /res\.redirect\(302,/, 'the redirect is not 302');
  assert.ok(!/redirect\(301/.test(q),
    'a 301 would be cached and later scans of the same sticker would never be counted');
  assert.match(q, /Cache-Control', 'no-store'/, 'the redirect is cacheable');
});

it('the scan is recorded even when the code is unknown or retired', () => {
  // Somebody standing in front of a retired sticker is still a real person,
  // and that is worth knowing before the next print run.
  const write = q.indexOf('/rest/v1/qr_scans');
  const unknown = q.indexOf('if (!row)');
  assert.ok(write > 0 && write < unknown,
    'the scan is written after the unknown-code check, so unknown scans are lost');
  assert.match(q, /console\.warn\(`qr: unknown code/, 'an unknown code is no longer flagged in the logs');
});

it('the code is normalised and bounded', () => {
  assert.match(q, /toLowerCase\(\)\.replace\(\/\[\^a-z0-9_-\]\/g, ''\)\.slice\(0, 32\)/,
    'the code is no longer normalised — a sticker printed in caps would miss, and a long path could write junk rows');
});

it('nothing personal is recorded', () => {
  // The question is "is the Falls Road sticker working", not who scanned it.
  //
  // Comments stripped first: the file says in prose that it records "No IP, no
  // location", and a check that cannot tell the code from the commentary is a
  // check that fires on its own documentation. That has now caught me three
  // times in this session, which is what makes it worth writing down.
  const code = q.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  assert.ok(!/x-forwarded-for|x-real-ip|latitude|longitude|geoip/i.test(code),
    'the QR route is recording location or IP — it only needs to count scans');
  assert.match(q, /slice\(0, 300\)/, 'the user agent and referrer are no longer bounded');
});

it('the admin screen shows the target beside the number', () => {
  // Half the run pointed at pages that did not exist. The lands_on and the zero
  // it produced belong on the same line, or the next wrong one is invisible.
  assert.match(admin, /'qr-stats'/, 'the admin endpoint no longer serves QR stats');
  assert.match(app, /\{r\.lands_on\}/, 'the admin screen no longer shows where each code lands');
  assert.match(app, /\(r\.scans \|\| 0\) === 0 \? 'text-\[#FFD27A\]'/,
    'a never-scanned code is no longer flagged');
});

console.log(`\n  ${passed} checks passed\n`);
