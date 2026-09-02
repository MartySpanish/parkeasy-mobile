// /events and /events/{slug}: the grouping, the timezone, and the SEO surface.
//
// THE TWO THINGS THAT GO WRONG SILENTLY HERE.
//
// 1. THE CLOCK. starts_at is timestamptz, so it arrives as UTC. Belfast is
//    UTC+1 for most of the gig season, so a 19:00 kickoff formatted with the
//    server's own clock reads 18:00 — an hour early, on the one page whose
//    entire job is telling somebody when to leave. Nothing throws; the page
//    just lies. Every assertion below therefore pins a REAL date on each side
//    of the DST boundary rather than "now".
//
// 2. THE SEO SURFACE SHRINKING. public/sitemap.xml was a hand-written file and
//    is now generated. A generated file that quietly drops the 24 area pages
//    would cost far more traffic than the events pages add, and would look
//    exactly like a working deploy. The old list is pinned here verbatim.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  groupByDate, tierOf, TIERS, esc, jsonLd, timeLocal, dayKey, fullLocal, parkNear,
} from '../../api/_eventsView.js';
import { STATIC } from '../../api/sitemap.js';
import { metres } from '../../api/events.js';

const vercel = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
const docs   = readFileSync(new URL('../../docs/events.md', import.meta.url), 'utf8');

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };

console.log('\neventsPages — the listing, the detail page, and the sitemap');

// ── Timezone ─────────────────────────────────────────────────────────────────
it('a summer kickoff shows in BST, not UTC', () => {
  // 2026-08-31T19:00Z is 20:00 in Belfast. Getting this wrong sends people an
  // hour early to every gig between March and October.
  assert.equal(timeLocal('2026-08-31T19:00:00+00:00'), '20:00');
});

it('a winter kickoff shows in GMT', () => {
  assert.equal(timeLocal('2026-12-05T19:00:00+00:00'), '19:00');
});

it('the London calendar day is used for grouping, not the UTC one', () => {
  // 23:30 UTC on the 30th is 00:30 on the 31st in Belfast — a different day,
  // and therefore a different group heading.
  assert.equal(dayKey('2026-08-30T23:30:00+00:00'), '2026-08-31');
  assert.equal(dayKey('2026-12-30T23:30:00+00:00'), '2026-12-30');
});

it('the long form names the weekday and the local time', () => {
  const s = fullLocal('2026-08-31T19:00:00+00:00');
  assert.match(s, /Monday/);
  assert.match(s, /31 August 2026/);
  assert.match(s, /20:00/);
});

// ── Grouping ─────────────────────────────────────────────────────────────────
const at = (iso, extra = {}) => ({ starts_at: iso, name: iso, ...extra });
const labels = (g) => g.map(x => x.label);

it('Today, Tomorrow and This weekend, in that order', () => {
  const monday = new Date('2026-08-24T09:00:00+00:00');   // a Monday
  const g = groupByDate([
    at('2026-08-24T18:00:00+00:00'),  // today
    at('2026-08-25T18:00:00+00:00'),  // tomorrow
    at('2026-08-26T18:00:00+00:00'),  // Wednesday
    at('2026-08-29T14:00:00+00:00'),  // Saturday  -> this weekend
    at('2026-08-30T14:00:00+00:00'),  // Sunday    -> this weekend
    at('2026-08-31T18:00:00+00:00'),  // next Monday
  ], monday);
  assert.deepEqual(labels(g),
    ['Today', 'Tomorrow', 'Wednesday 26 August', 'This weekend', 'Monday 31 August']);
});

it('the weekend group holds both days and nothing else', () => {
  const monday = new Date('2026-08-24T09:00:00+00:00');
  const g = groupByDate([
    at('2026-08-29T14:00:00+00:00'), at('2026-08-30T14:00:00+00:00'),
  ], monday);
  assert.equal(g.length, 1);
  assert.equal(g[0].events.length, 2);
});

it('no event is ever listed twice', () => {
  const monday = new Date('2026-08-24T09:00:00+00:00');
  const rows = ['2026-08-24','2026-08-25','2026-08-26','2026-08-29','2026-08-30','2026-08-31']
    .map(d => at(`${d}T14:00:00+00:00`));
  const g = groupByDate(rows, monday);
  const seen = g.flatMap(x => x.events.map(e => e.starts_at));
  assert.equal(seen.length, rows.length, 'an event appeared in more than one group');
  assert.equal(new Set(seen).size, rows.length);
});

it('on a Saturday, today wins over "this weekend"', () => {
  // Otherwise the two buckets fight over the same rows and the more useful
  // heading — the one that says the event is TODAY — loses.
  const saturday = new Date('2026-08-29T09:00:00+00:00');
  const g = groupByDate([
    at('2026-08-29T14:00:00+00:00'), at('2026-08-30T14:00:00+00:00'),
  ], saturday);
  assert.deepEqual(labels(g), ['Today', 'Tomorrow']);
});

it('on a Sunday, "this weekend" does not mean NEXT weekend', () => {
  // The sharp case, and the only one the isWeekendNow guard actually changes.
  // On a Sunday the "coming Saturday" is six days out, so without the guard an
  // event next Saturday gets the heading "This weekend" — which is wrong by a
  // week, on a page people use to decide when to leave the house. Saturday
  // looks fine either way, because Today and Tomorrow claim both days first.
  const sunday = new Date('2026-08-30T09:00:00+00:00');
  const g = groupByDate([
    at('2026-08-30T14:00:00+00:00'),   // today
    at('2026-09-05T14:00:00+00:00'),   // NEXT Saturday
    at('2026-09-06T14:00:00+00:00'),   // NEXT Sunday
  ], sunday);
  assert.deepEqual(labels(g), ['Today', 'Saturday 5 September', 'Sunday 6 September']);
});

// ── Tiers ────────────────────────────────────────────────────────────────────
it('every tier has a colour and an attendance band', () => {
  for (const k of ['major', 'high', 'medium', 'low']) {
    const t = TIERS[k];
    assert.ok(t.fg && t.bg && t.bd, `${k} is missing a colour`);
    assert.ok(t.blurb, `${k} is missing its band`);
  }
});

it('an unknown or missing tier falls back to low, never to a crash', () => {
  // demand_tier is free text in the database and a sweep can write anything.
  assert.equal(tierOf(undefined).label, 'Low');
  assert.equal(tierOf('MAJOR').label, 'Major');
  assert.equal(tierOf('enormous').label, 'Low');
});

it('the bands documented in docs/events.md match the code', () => {
  for (const [k, t] of Object.entries(TIERS)) {
    assert.ok(docs.includes(t.blurb), `docs/events.md does not mention the ${k} band "${t.blurb}"`);
  }
});

// ── Escaping ─────────────────────────────────────────────────────────────────
it('event names are escaped before they reach the page', () => {
  // Names come from whoever ran the weekly sweep, via a scraped listings page.
  assert.equal(esc('<script>x</script>'), '&lt;script&gt;x&lt;/script&gt;');
  assert.equal(esc(`Fleadh "an" Phobail & co`), 'Fleadh &quot;an&quot; Phobail &amp; co');
  assert.equal(esc(null), '');
});

it('JSON-LD cannot close its own script tag', () => {
  assert.ok(!jsonLd({ name: '</script><img onerror=1>' }).includes('</script>'));
});

// ── The CTA target ───────────────────────────────────────────────────────────
it('the parking CTA carries the venue coordinates and the event', () => {
  const u = parkNear({ lat: 54.5934, lng: -5.9317, venue_name: 'Ulster Hall', slug: 'mac-x' });
  assert.match(u, /^\/\?near=54\.5934,-5\.9317&place=Ulster%20Hall&event=mac-x$/);
});

it('distance is real metres', () => {
  // Belfast City Hall to the Ulster Hall is about 500m.
  const d = metres(54.5964, -5.9302, 54.5934, -5.9317);
  assert.ok(d > 300 && d < 500, `expected roughly 350m, got ${Math.round(d)}m`);
});

// ── Routing ──────────────────────────────────────────────────────────────────
it('both routes are rewritten, ahead of the SPA catch-all', () => {
  const srcs = vercel.rewrites.map(r => r.source);
  const catchAll = srcs.findIndex(s => s.includes('(?!api/)'));
  for (const s of ['/events', '/events/:slug', '/sitemap.xml']) {
    const i = srcs.indexOf(s);
    assert.ok(i !== -1, `${s} is not rewritten — it would serve the React app`);
    assert.ok(catchAll === -1 || i < catchAll, `${s} sits after the SPA catch-all`);
  }
  assert.equal(vercel.rewrites.find(r => r.source === '/events/:slug').destination,
    '/api/events?slug=:slug');
});

// ── The sitemap must not shrink ──────────────────────────────────────────────
it('every URL from the old hand-written sitemap survived', () => {
  // Verbatim from public/sitemap.xml as it stood before it became a function.
  const WAS = ['/', ...[
    'belfast','derry','lisburn','newtownabbey','bangor','newry','antrim','ballymena',
    'coleraine','portrush','carrickfergus','larne','enniskillen','omagh','dungannon',
    'cookstown','strabane','downpatrick','newcastle','portadown','craigavon',
    'ballycastle','banbridge','magherafelt',
  ].map(a => `/area/${a}.html`)];
  const now = new Set(STATIC.map(s => s.loc));
  for (const loc of WAS) assert.ok(now.has(loc), `${loc} fell out of the sitemap`);
  assert.equal(WAS.length, 25);
});

it('the sitemap gained /events', () => {
  assert.ok(STATIC.some(s => s.loc === '/events'), '/events is not in the sitemap');
});

console.log(`\n  ${passed} checks passed\n`);
