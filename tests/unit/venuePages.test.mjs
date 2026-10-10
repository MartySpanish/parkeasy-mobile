// /venue/{slug}: the hub the 313 event pages link up into.
//
// WHY THIS FILE RENDERS REAL HTML rather than grepping the source. The venue
// page is assembled from six helpers that already existed for /events, and the
// failure modes are all about what comes out the other end: a distance that
// claims precision nobody measured, a schema advertising an event the page does
// not show, a noindex that disagrees with the sitemap. None of those is visible
// in a regex over the renderer.
//
// THE FOUR THINGS THAT GO WRONG SILENTLY HERE.
//
//   1. INVENTED PRECISION. venues.geo_verified is false on 16 of the 17 rows.
//      The event page printed `${Math.round(d)}m away` — one-metre precision
//      from two unsurveyed pins, on the line where somebody decides whether
//      they can walk it. Nothing throws; the page just overstates what we know.
//   2. A SITEMAP THAT CONTRADICTS A ROBOTS TAG. The six destination pages were
//      in the sitemap AND noindexed at the same time for a release. A venue
//      with no fixtures is ~90 words, so it carries noindex — and the sitemap
//      has to use the identical rule or we have told Googlebot two things.
//   3. SCHEMA DRIFTING FROM THE PAGE. The ItemList is built from the same array
//      the page renders. Build it from a second query and it eventually
//      advertises events the visitor cannot see.
//   4. A VENUE PAGE THAT 503s. Fixtures and listings are both optional: a venue
//      is worth serving with just its parking notes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderVenue, renderEvent } from '../../api/events.js';
import { distanceLabel, venuePlace, parkAtVenue } from '../../api/_eventsView.js';

const vercel = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
const docs = readFileSync(new URL('../../docs/events.md', import.meta.url), 'utf8');

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };
const ita = async (what, fn) => { await fn(); passed++; console.log(`  PASS  ${what}`); };

console.log('\nvenuePages — one page per venue, and what it is allowed to claim');

// Real Belfast geography, and real column names from tests/db/event_pricing_seed.sql.
const HALL = {
  slug: 'ulster-hall', name: 'Ulster Hall', venue_type: 'concert hall',
  address: '34 Bedford Street', town: 'Belfast', postcode: 'BT2 7FF',
  lat: 54.5934, lng: -5.9317, capacity: 1000, geo_verified: false,
  website_url: 'https://ulsterhall.co.uk',
  parking_notes: 'There is no on-site parking.\n\nThe Linenhall Street car park is closest.',
};
const ev = (over = {}) => ({
  slug: 'a-gig', name: 'A Gig', subtitle: null, starts_at: '2026-10-20T19:30:00+00:00',
  demand_tier: 'high', expected_attendance: 1800, status: 'scheduled', ...over,
});
const listing = (over = {}) => ({
  id: 'l1', title: 'Bedford Street yard', price_per_hour: 3, price_per_day: 20, d: 412, ...over,
});

// ── 1. Invented precision ────────────────────────────────────────────────────
it('a distance we do not have never renders as the flattering one', () => {
  // THE DEFECT THIS CAUGHT DURING WRITING. Number(null) is 0, which is finite
  // and not negative, so the first version reported a missing distance as
  // "under 100m away" — the single most encouraging thing it could have said.
  for (const v of [null, undefined, '', NaN, -5, 'x']) {
    assert.equal(distanceLabel(v), 'nearby', `distanceLabel(${String(v)}) is not "nearby"`);
  }
});

it('distances are banded, not stated to the metre', () => {
  assert.equal(distanceLabel(0), 'under 100m away');
  assert.equal(distanceLabel(42), 'under 100m away');
  assert.equal(distanceLabel(99.9), 'under 100m away');
  assert.equal(distanceLabel(412), 'about 400m away');   // nearest 50m
  assert.equal(distanceLabel(437), 'about 450m away');
  assert.equal(distanceLabel(999), 'about 1000m away');
  assert.equal(distanceLabel(1640), 'about 1.6km away');
});

it('no page prints a bare metre figure for a listing', () => {
  // Mutation: put ${Math.round(l.d)}m back in either renderer and this fails.
  // Checked on both pages, because they share the listings markup and only one
  // of them was fixed by hand.
  const venue = renderVenue(HALL, [ev()], [listing({ d: 412 }), listing({ id: 'l2', d: 1337 })]);
  const event = renderEvent(
    { ...ev(), venue_name: HALL.name, venue_slug: HALL.slug, lat: HALL.lat, lng: HALL.lng,
      postcode: HALL.postcode, parking_notes: HALL.parking_notes },
    [listing({ d: 412 })]);
  for (const [where, html] of [['venue page', venue], ['event page', event]]) {
    const dists = [...html.matchAll(/class="dist"[^>]*>([^<]*)</g)].map(m => m[1]);
    assert.ok(dists.length, `${where} rendered no distance at all`);
    for (const d of dists) {
      assert.ok(!/\b412m\b|\b1337m\b/.test(d),
        `${where} printed an unrounded distance: "${d}" — geo_verified is false on 16 of 17 venues`);
      assert.match(d, /^(nearby|under 100m away|about [\d.]+(m|km) away)/,
        `${where} distance "${d}" is not one of the honest bands`);
    }
  }
});

it('no walking time is claimed anywhere on the page', () => {
  // A straight line between two unverified pins is not a route. Mutation: add
  // "a 5 minute walk" and this fails.
  const html = renderVenue(HALL, [ev()], [listing()]);
  assert.ok(!/minute walk|min walk|walk\b.*\bminute/i.test(html),
    'the venue page claims a walking time, which needs a route we do not have');
});

// ── 2. noindex, and the sitemap agreeing with it ─────────────────────────────
it('a venue with no fixtures is noindexed, and one with fixtures is not', () => {
  const thin = renderVenue(HALL, [], []);
  assert.match(thin, /<meta name="robots" content="noindex,follow">/,
    'a venue page with no fixtures is ~90 words and must not be indexed');
  const full = renderVenue(HALL, [ev()], []);
  assert.ok(!/name="robots"/.test(full),
    'a venue with a fixture list is still noindexed — the page can never earn the index');
});

it('noindex turns on fixtures alone, not on having a bookable space', () => {
  // The sitemap decides from the events query and nothing else. If the page
  // ALSO dropped its noindex for a venue that merely has a listing nearby, the
  // two rules would diverge and a noindexed URL would never be advertised —
  // which is the harmless direction, but an indexable orphan with nothing
  // linking to it is still a page nobody can reach.
  const noEventsButBookable = renderVenue(HALL, [], [listing()]);
  assert.match(noEventsButBookable, /name="robots" content="noindex,follow"/,
    'a venue with a bookable space but no fixtures is indexable, while the sitemap '
    + 'only advertises venues with fixtures — the two rules have diverged');
});

// ── 3. The schema says exactly what the page shows ───────────────────────────
const jsonBlocks = (html) =>
  [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map(m => JSON.parse(m[1].replace(/\\u003c/g, '<')));

it('the ItemList lists every event on the page and no others', () => {
  const events = [ev({ slug: 'g1', name: 'One' }), ev({ slug: 'g2', name: 'Two' }),
                  ev({ slug: 'g3', name: 'Three' })];
  const html = renderVenue(HALL, events, []);
  const list = jsonBlocks(html).find(b => b['@type'] === 'ItemList');
  assert.ok(list, 'no ItemList was emitted for a venue with fixtures');
  assert.equal(list.numberOfItems, events.length);
  assert.equal(list.itemListElement.length, events.length);
  for (const el of list.itemListElement) {
    assert.ok(html.includes(`href="/events/${el.item.url.split('/').pop()}"`),
      `the schema advertises ${el.item.url} but the page does not link to it`);
  }
  assert.deepEqual(list.itemListElement.map(e => e.position), [1, 2, 3]);
});

it('the Place is the venue, and is not claimed to be a car park', () => {
  // ParkingFacility here would say the Ulster Hall IS a car park. It is not,
  // and the private driveways nearby are not published as facilities because
  // their addresses are not ours to put in a search index.
  const html = renderVenue(HALL, [ev()], [listing()]);
  const place = jsonBlocks(html).find(b => b['@type'] === 'Place');
  assert.ok(place, 'no Place schema for the venue');
  assert.equal(place.name, HALL.name);
  assert.equal(place.address.postalCode, 'BT2 7FF');
  assert.equal(place.geo.latitude, HALL.lat);
  assert.ok(!html.includes('ParkingFacility'),
    'the venue is described as a ParkingFacility — it is a concert hall');
  // Every event points at the Place by @id rather than repeating the address.
  const list = jsonBlocks(html).find(b => b['@type'] === 'ItemList');
  assert.equal(list.itemListElement[0].item.location['@id'], place['@id']);
});

it('a hostile venue name cannot close its own script tag or inject markup', () => {
  const html = renderVenue(
    { ...HALL, name: '</script><img onerror=1>', parking_notes: '<b>hi</b>' },
    [ev({ name: '"><script>x</script>' })], []);
  assert.ok(!html.includes('</script><img'), 'the JSON-LD was closed early');
  assert.ok(!html.includes('<img onerror'), 'a venue name reached the page as markup');
  assert.ok(!html.includes('<b>hi</b>'), 'parking notes reached the page as markup');
  // And it is still valid JSON after escaping.
  assert.doesNotThrow(() => jsonBlocks(html), 'the escaped JSON-LD no longer parses');
});

// ── The honest chips and the CTA ─────────────────────────────────────────────
it('capacity and type are shown only when the row actually has them', () => {
  const full = renderVenue(HALL, [], []);
  assert.match(full, /Holds 1,000/, 'capacity is not shown');
  assert.match(full, /Concert hall/, 'venue_type is not shown, or is not sentence-cased');
  const bare = renderVenue({ ...HALL, capacity: 0, venue_type: null, town: null, postcode: null }, [], []);
  assert.ok(!/Holds/.test(bare), 'a zero capacity was printed as a claim about the venue');
  assert.ok(!/undefined|null|NaN/.test(bare), 'a missing column leaked into the page');
});

it('the venue CTA carries the venue, never an event slug', () => {
  const u = parkAtVenue(HALL);
  assert.match(u, /^\/\?near=54\.5934,-5\.9317&place=Ulster%20Hall&venue=ulster-hall$/);
  assert.ok(!u.includes('event='),
    'the venue CTA labels itself as an event — parkNear() was reused instead of parkAtVenue()');
});

it('a venue with no coordinates renders without a map or a search CTA', () => {
  // Both would need a lat/lng. parkNear with undefined coordinates sends the
  // app a "near=undefined,undefined" it correctly ignores, landing the visitor
  // on an unsearched map — worse than no button.
  const html = renderVenue({ ...HALL, lat: null, lng: null }, [ev()], []);
  // RE-ANCHORED. This asserted the absence of 'staticmap.openstreetmap.de',
  // which stopped meaning anything the day that provider was removed from the
  // codebase — the string cannot appear now whatever the coordinates are, so
  // the check passed by construction. The diagram that replaced it is an
  // inline <svg>, so that is what must be absent.
  assert.ok(!html.includes('<svg'), 'a diagram was drawn for a venue with no position');
  // `class="mapwrap"`, not `mapwrap`: the bare string also appears in
  // HEAD_CSS, which every page carries, so the loose version was asserting
  // against the stylesheet rather than the markup.
  assert.ok(!html.includes('class="mapwrap"'),
    'an empty map frame was rendered without coordinates');
  assert.ok(!/near=null|near=undefined/.test(html), 'a CTA was rendered without coordinates');
  assert.match(html, /What&#39;s on at Ulster Hall/, 'the fixture list vanished with the map');
});

it('venuePlace renames the columns the events helpers expect', () => {
  const p = venuePlace(HALL);
  assert.equal(p.venue_name, 'Ulster Hall');
  assert.equal(p.venue_slug, 'ulster-hall');
  assert.equal(p.lat, HALL.lat);
});

// ── The parking notes are the page's reason to exist ─────────────────────────
it('the parking notes are rendered, as paragraphs', () => {
  const html = renderVenue(HALL, [ev()], []);
  assert.match(html, /<p>There is no on-site parking\.<\/p>/);
  assert.match(html, /<p>The Linenhall Street car park is closest\.<\/p>/,
    'a blank line in parking_notes collapsed the second paragraph away');
});

// ── 4. The event page links up, and the routes exist ─────────────────────────
it('an event page links to its venue page, twice', () => {
  const html = renderEvent(
    { ...ev(), venue_name: HALL.name, venue_slug: HALL.slug, lat: HALL.lat, lng: HALL.lng,
      parking_notes: HALL.parking_notes }, []);
  const links = [...html.matchAll(/href="\/venue\/ulster-hall"/g)];
  assert.ok(links.length >= 2,
    `the event page links to /venue/ulster-hall ${links.length} time(s) — the 313 event `
    + 'pages are how the venue pages are discovered');
  // And it must not break when the view has no venue_slug.
  //
  // THE FIRST VERSION OF THIS CHECKED FOR "/venue/null" AND A MUTATION WALKED
  // STRAIGHT PAST IT. esc(null) returns '', so dropping the venue_slug guard
  // renders href="/venue/" — a link to a route that 404s, which the test called
  // clean because the literal string "null" never appeared. The assertion is
  // therefore that NO venue link is emitted at all, which is the actual rule.
  const noSlug = renderEvent(
    { ...ev(), venue_name: HALL.name, venue_slug: null, lat: HALL.lat, lng: HALL.lng,
      parking_notes: HALL.parking_notes }, []);
  const stray = [...noSlug.matchAll(/href="(\/venue\/[^"]*)"/g)].map(m => m[1]);
  assert.deepEqual(stray, [],
    `a venue link was emitted without a venue_slug: ${stray.join(', ')}`);
  assert.match(noSlug, /Ulster Hall/, 'the venue name vanished along with its link');
});

it('/venue/:slug is rewritten ahead of the SPA catch-all', () => {
  const srcs = vercel.rewrites.map(r => r.source);
  const catchAll = srcs.findIndex(s => s.includes('(?!api/)'));
  const i = srcs.indexOf('/venue/:slug');
  assert.ok(i !== -1, '/venue/:slug is not rewritten — it would serve the React app');
  assert.ok(catchAll === -1 || i < catchAll, '/venue/:slug sits after the SPA catch-all');
  assert.equal(vercel.rewrites[i].destination, '/api/events?venue=:slug');
});

it('every route in the docs table is a route that actually exists', () => {
  // THE FIRST VERSION OF THIS ASKED ONLY WHETHER "/venue/{slug}" APPEARED
  // ANYWHERE, and a mutation that changed the route TABLE to /venues/{slug}
  // survived, because the section heading further down still said /venue/.
  // The table is the thing somebody reads to find the route, so the table is
  // what gets checked — against vercel.json rather than against itself.
  const rows = [...docs.matchAll(/^\| `(\/[^`]+)` \|/gm)].map(m => m[1]);
  assert.ok(rows.length >= 3, `the docs route table lists ${rows.length} routes, expected 3`);
  assert.ok(rows.includes('/venue/{slug}'), 'the venue route is not in the docs route table');
  const sources = new Set(vercel.rewrites.map(r => r.source));
  for (const r of rows) {
    const source = r.replace(/\{(\w+)\}/g, ':$1');
    assert.ok(sources.has(source),
      `docs/events.md documents ${r}, but vercel.json has no rewrite for ${source}`);
  }
});

// ── The handler, against a stubbed PostgREST ─────────────────────────────────
// The renderers above are pure; these two check the wiring that is not: which
// query answers which route, what a missing venue returns, and that a failing
// sub-query degrades the page instead of the status code.
const fakeRes = () => {
  const r = { headers: {}, code: null, body: null };
  r.setHeader = (k, v) => { r.headers[k.toLowerCase()] = v; };
  r.status = (c) => { r.code = c; return r; };
  r.send = (b) => { r.body = b; return r; };
  return r;
};

/** Stub PostgREST. `rows` maps a table name to rows, or to an Error to throw. */
async function withDb(rows, fn) {
  const realFetch = globalThis.fetch;
  const realUrl = process.env.VITE_SUPABASE_URL;
  const realKey = process.env.VITE_SUPABASE_ANON_KEY;
  process.env.VITE_SUPABASE_URL = 'https://stub.supabase.co';
  process.env.VITE_SUPABASE_ANON_KEY = 'stub-anon-key';
  const seen = [];
  globalThis.fetch = async (url) => {
    const path = String(url).split('/rest/v1/')[1] || '';
    const table = path.split('?')[0];
    seen.push(path);
    const v = rows[table];
    if (v instanceof Error) return { ok: false, status: 500, json: async () => [] };
    return { ok: true, status: 200, json: async () => v || [] };
  };
  try { return await fn(seen); } finally {
    globalThis.fetch = realFetch;
    if (realUrl === undefined) delete process.env.VITE_SUPABASE_URL; else process.env.VITE_SUPABASE_URL = realUrl;
    if (realKey === undefined) delete process.env.VITE_SUPABASE_ANON_KEY; else process.env.VITE_SUPABASE_ANON_KEY = realKey;
  }
}

const soon = () => new Date(Date.now() + 5 * 86400000).toISOString();

await ita('?venue= renders the venue page and asks only the venues table for it', async () => {
  const { default: handler } = await import('../../api/events.js');
  await withDb({
    venues: [HALL],
    upcoming_events: [{ ...ev(), starts_at: soon(), venue_slug: HALL.slug, venue_name: HALL.name }],
    rental_listings: [{ id: 'l1', title: 'Yard', lat: 54.5940, lng: -5.9320, price_per_day: 20 }],
  }, async (seen) => {
    const res = fakeRes();
    await handler({ query: { venue: 'ulster-hall' } }, res);
    assert.equal(res.code, 200);
    assert.match(res.body, /<h1>Parking at Ulster Hall<\/h1>/);
    assert.match(res.headers['cache-control'], /s-maxage=600/);
    // The events query must be filtered to this venue, or every venue page
    // shows every event in Belfast.
    const q = seen.find(p => p.startsWith('upcoming_events'));
    assert.ok(q && q.includes('venue_slug=eq.ulster-hall'),
      `the events query is not scoped to the venue: ${q}`);
    assert.ok(seen.some(p => p.startsWith('venues') && p.includes('active=is.true')),
      'the venues query does not filter to active rows');
  });
});

await ita('an unknown venue is a 404 that is never cached', async () => {
  const { default: handler } = await import('../../api/events.js');
  await withDb({ venues: [] }, async () => {
    const res = fakeRes();
    await handler({ query: { venue: 'nope' } }, res);
    assert.equal(res.code, 404);
    assert.equal(res.headers['cache-control'], 'no-store');
    // The heading goes through esc(), so a typed entity would double-escape.
    assert.ok(!res.body.includes('&amp;rsquo;'), 'an HTML entity was escaped twice in the 404 heading');
  });
});

await ita('a failing events or listings query degrades the page, not the status', async () => {
  const { default: handler } = await import('../../api/events.js');
  await withDb({
    venues: [HALL], upcoming_events: new Error('down'), rental_listings: new Error('down'),
  }, async () => {
    const res = fakeRes();
    await handler({ query: { venue: 'ulster-hall' } }, res);
    assert.equal(res.code, 200, 'a venue page 503d because its optional sections failed');
    assert.match(res.body, /There is no on-site parking/, 'the parking notes went down with them');
    assert.match(res.body, /name="robots" content="noindex,follow"/,
      'an events outage produced an indexable page with no fixtures on it');
  });
});

await ita('an unreadable venues table falls back to the event view, not to a 404', async () => {
  // THE ONE DEPENDENCY NOTHING IN THIS CODEBASE HAS EVER PROVED: that anon can
  // SELECT public.venues. Every other read here goes through a view. If the
  // grant is missing, PostgREST answers 401 and all sixteen venue pages 404
  // while looking perfectly healthy — no error, no empty state.
  const { default: handler } = await import('../../api/events.js');
  await withDb({
    venues: new Error('401'),
    upcoming_events: [{
      ...ev(), starts_at: soon(), venue_slug: HALL.slug, venue_name: HALL.name,
      postcode: HALL.postcode, lat: HALL.lat, lng: HALL.lng,
      venue_capacity: 1000, parking_notes: HALL.parking_notes,
    }],
    rental_listings: [],
  }, async () => {
    const res = fakeRes();
    await handler({ query: { venue: 'ulster-hall' } }, res);
    assert.equal(res.code, 200, 'an unreadable venues table 404d the venue page');
    assert.match(res.body, /<h1>Parking at Ulster Hall<\/h1>/);
    assert.match(res.body, /There is no on-site parking/, 'the parking notes did not survive the fallback');
    assert.match(res.body, /Holds 1,000/, 'venue_capacity did not survive the fallback');
    assert.ok(!/undefined|null,|NaN/.test(res.body), 'a column the view does not carry leaked in as a blank');
    assert.ok(!/name="robots"/.test(res.body), 'the fallback page is noindexed despite having a fixture');
  });
});

await ita('an EMPTY venues table is still a 404, never a fallback', async () => {
  // Zero rows is a correct answer: no such venue, or active = false (Casement
  // Park is a building site). Falling back here would publish a page for a
  // venue we deliberately switched off.
  const { default: handler } = await import('../../api/events.js');
  await withDb({
    venues: [],
    upcoming_events: [{ ...ev(), starts_at: soon(), venue_slug: 'casement-park', venue_name: 'Casement Park' }],
  }, async () => {
    const res = fakeRes();
    await handler({ query: { venue: 'casement-park' } }, res);
    assert.equal(res.code, 404,
      'an inactive venue was resurrected from its own events — active = false means no page');
  });
});

await ita('the sitemap advertises exactly the venues that are not noindexed', async () => {
  const { default: sitemap } = await import('../../api/sitemap.js');
  const WITH = { slug: 'ulster-hall' }, WITHOUT = { slug: 'casement-park' };
  await withDb({
    upcoming_events: [{ slug: 'g1', days_away: 5, venue_slug: WITH.slug, starts_at: soon() }],
    venues: [WITH, WITHOUT],
  }, async (seen) => {
    const res = fakeRes();
    await sitemap({}, res);
    assert.equal(res.code, 200);
    assert.ok(res.body.includes('<loc>https://parkeasy.uk/venue/ulster-hall</loc>'),
      'a venue with a fixture is missing from the sitemap');
    // The venues table is the AUTHORITATIVE answer to "is this venue still
    // active", and it is only that if the query says so. Without this the
    // degraded path (slugs from the event view) would be the only thing
    // deciding, and it cannot see `active` at all.
    assert.ok(seen.some(p => p.startsWith('venues') && p.includes('active=is.true')),
      'the sitemap reads venues without filtering to active rows');
    assert.ok(!res.body.includes('/venue/casement-park'),
      'a venue with no fixtures is in the sitemap AND noindexed — the contradiction that '
      + 'cost the destination pages a release');
    // And the static pages still survived, which is what eventsPages.test.mjs guards.
    assert.ok(res.body.includes('<loc>https://parkeasy.uk/area/belfast.html</loc>'));
  });
});

await ita('an unreadable venues table does not empty the sitemap of venues', async () => {
  // Without the fallback this silently drops all sixteen venue URLs while
  // api/events.js serves every one of those pages perfectly well.
  const { default: sitemap } = await import('../../api/sitemap.js');
  await withDb({
    upcoming_events: [{ slug: 'g1', days_away: 5, venue_slug: 'ulster-hall', starts_at: soon() }],
    venues: new Error('401'),
  }, async () => {
    const res = fakeRes();
    await sitemap({}, res);
    assert.equal(res.code, 200);
    assert.ok(res.body.includes('<loc>https://parkeasy.uk/venue/ulster-hall</loc>'),
      'the venue URLs vanished from the sitemap while the pages themselves still render');
    // And the fallback must not invent a venue that has no fixture.
    assert.equal((res.body.match(/\/venue\//g) || []).length, 1);
  });
});

await ita('a database outage drops the venues but still serves the static sitemap', async () => {
  const { default: sitemap } = await import('../../api/sitemap.js');
  await withDb({ upcoming_events: new Error('down'), venues: new Error('down') }, async () => {
    const res = fakeRes();
    await sitemap({}, res);
    assert.equal(res.code, 200);
    assert.ok(!res.body.includes('/venue/'), 'a venue URL survived an outage it could not be checked against');
    assert.equal(res.headers['cache-control'], 'public, s-maxage=60');
  });
});

console.log(`\n  ${passed} checks passed\n`);
