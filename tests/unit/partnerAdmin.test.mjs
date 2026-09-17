// The admin screen that sells the next card.
//
// Two things here move money or leak it, and neither would throw:
//
//   - the checkout link is for the PARTNER. Opening it in the admin's own
//     browser starts Marty paying for their card himself.
//   - partner_stats returns the whole book of business — what each partner
//     pays and when they renew — so the endpoint behind it must stay
//     service_role, reached only through the admin-verified handler.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const app   = read('../../src/App.jsx');
const admin = read('../../api/admin.js');
const stats = read('../../api/partners/stats.js');

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };

console.log('\npartnerAdmin — the screen that sells the next card');

it('the checkout link is copied for the partner, never opened here', () => {
  const fn = app.slice(app.indexOf('const sendCheckoutLink'), app.indexOf('const sendCheckoutLink') + 1200);
  assert.match(fn, /clipboard\.writeText\(j\.url\)/, 'the link is no longer copied');
  assert.ok(!/window\.location\.href\s*=\s*j\.url|window\.open\(j\.url/.test(fn),
    'the admin screen opens the partner\'s checkout link — that starts Marty paying for their card');
});

it('a tier change patches in place instead of rescanning 30 days', () => {
  const fn = app.slice(app.indexOf('const setPartnerTier'), app.indexOf('const setPartnerTier') + 900);
  assert.match(fn, /rows: s\.rows\.map/, 'the tier change refetches the whole aggregate for one row');
});

it('the tier endpoint only accepts real tiers', () => {
  const block = admin.slice(admin.indexOf("'set-partner-tier'"), admin.indexOf("'set-partner-tier'") + 900);
  assert.match(block, /\['listed', 'featured', 'sponsored'\]/, 'the tier allowlist is gone');
  assert.match(block, /allowed\.includes\(p\.tier\)/, 'the endpoint no longer validates the tier');
});

it('the whole book of business stays behind the admin check', () => {
  // Both actions sit inside api/admin.js, which verifies the caller's JWT and
  // email before anything below it runs.
  const gate = admin.indexOf("ADMINS.includes((caller.email");
  assert.ok(gate > 0, 'the admin email check is gone');
  assert.ok(admin.indexOf("'partner-stats'") > gate,
    'the partner-stats action runs before the admin check');
  assert.ok(admin.indexOf("'set-partner-tier'") > gate,
    'the tier action runs before the admin check');
  assert.match(admin, /rpc\/partner_stats/, 'the admin endpoint no longer calls the stats function');
});

it('the partner-facing page escapes the name it renders', () => {
  // The name comes out of the database and the page is HTML.
  assert.match(stats, /replace\(\/\[&<>"\]\/g/, 'the partner name is interpolated into HTML unescaped');
  assert.match(stats, /Cache-Control', 'no-store'/,
    'the stats page is cacheable — a renewal conversation would show last week\'s numbers');
  assert.match(stats, /\[0-9a-f\]\{8\}-/, 'the token is no longer shape-checked before use');
});

it('a partner with impressions and no taps is visible, not hidden', () => {
  // Marcus Donnelly is 42 shown / 0 taps today. That row is the reason to look
  // at the screen at all, so it is coloured rather than dropped.
  assert.match(app, /r\.impressions > 0 && r\.clicks === 0 \? 'text-\[#FFD27A\]'/,
    'a partner whose card gets no taps is no longer flagged');
});

console.log(`\n  ${passed} checks passed\n`);
