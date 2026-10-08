// Build step: make the six destination pages worth indexing, then let them be.
//
// THE PROBLEM. /area/qub.html, botanic, city-hospital, sse-arena,
// titanic-quarter and cathedral-quarter target the highest-intent parking
// queries ParkEasy owns. All six shipped as ~130 words — a description, two
// paragraphs of boilerplate identical across all six, and a "Why ParkEasy?"
// card with the same text on every one — so PR #194 noindexed them and
// shrank the sitemap from 31 to 25. That was the right call on thin
// near-duplicate content. It also meant the best six URLs in the product were
// invisible to Google.
//
// WHAT THIS INJECTS, per page:
//   1. The real publishable spots near that destination, named, with their
//      restriction, price, space count and a walking time computed from the
//      coordinates — out of the same 787 surveyed spaces the app renders.
//   2. Three FAQs written against that data, as FAQPage JSON-LD and as visible
//      text (Google needs both; an answer only in JSON-LD is not an answer).
//   3. ParkingFacility JSON-LD for each named car park — the schema.org type
//      built for exactly this product, which the site used nowhere.
//   4. A last-updated date, because parking restrictions change and a page
//      that will not say when it was written cannot be trusted on them.
//   5. The noindex meta removed, LAST, and only once the page has all of the
//      above. api/sitemap.js lists the six on the same condition.
//
// ⚠️ THE GEM ASSERTION IS THE POINT OF THIS FILE, NOT A DETAIL.
//
// Hidden gems are what Premium sells. 20260820_hidden_gems.sql exists because
// they used to ship in the app bundle, where "the lock is drawn in the UI; the
// exact coordinates and notes are one devtools tab away for anybody who has
// never paid". A static page built to be crawled is a wider door than that.
//
// isPublishable() keeps gems out of the generated lists. It cannot keep them
// out of the PROSE, and the first draft of destinations.js named two — Riddel
// Hall under Queen's and the Stranmillis Road free car park under Botanic,
// both hidden_gem rows. So every finished page is searched for every gem name
// before it is written, and a hit throws. generate-globe-data.mjs asserts the
// same thing about its own output, for the same reason.
//
// Never fails the build for a MISSING page or marker — a broken deploy costs
// more than an un-upgraded page — but it does fail for a leak, because
// shipping the paid product to Google is not a degraded outcome, it is the
// one outcome worse than doing nothing.
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { loadAllSpots } from './lib/loadSpots.mjs';
import { DESTINATIONS } from '../src/data/destinations.js';
import { nearestPublishable, isPublishable } from '../src/data/publicSpots.js';

const DIR = 'dist/area';
const RADIUS_M = 1200;
const LIMIT = 8;

const esc = (s) => String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
/** JSON-LD goes inside <script>, where the only dangerous sequence is </. */
const jsonLd = (o) => JSON.stringify(o).replace(/</g, '\\u003c');

const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
const prettyToday = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', day: 'numeric', month: 'long', year: 'numeric',
}).format(new Date());

const all = loadAllSpots();

// Every gem name, and every area label that is itself a gem's name. Both are
// withheld: generate-globe-data.mjs found that "Lagan Meadows", "Wallace Park"
// and "Riverdale Car Park" are each one gem's name and another's `near`.
const gemNames = new Set(
  all.filter(s => s.badge === 'hidden_gem').map(s => s.name).filter(Boolean)
    .map(n => String(n).trim()).filter(n => n.length > 3),
);

/** A car park we can describe as a facility, rather than a stretch of kerb. */
const isFacility = (s) => ['official', 'paid'].includes(s.badge) || /car park/i.test(s.name || '');

const priceLine = (s) => {
  const bits = [];
  if (s.restriction) bits.push(s.restriction);
  if (s.price) bits.push(s.price);
  if (s.spaces) bits.push(`${s.spaces} spaces`);
  return bits.join(' · ');
};

const spotRow = (r) => {
  const s = r.spot;
  const free = s.badge === 'free' && !s.price;
  return `<li style="padding:12px 0;border-top:1px solid rgba(255,255,255,.08)">
<div style="display:flex;justify-content:space-between;gap:12px;align-items:baseline">
<strong style="color:#EAF1F8">${esc(s.name)}</strong>
<span style="color:${free ? '#6BEFB9' : 'rgba(234,241,248,.6)'};font-size:13px;white-space:nowrap">${free ? 'Free' : esc(s.price || 'Paid')}</span>
</div>
<div style="color:rgba(234,241,248,.66);font-size:13.5px;margin-top:2px">${esc(priceLine(s))}</div>
<div style="color:rgba(234,241,248,.45);font-size:12.5px;margin-top:2px">${r.walkMin} min walk &middot; ${Math.round(r.metres)} m</div>
</li>`;
};

const faqBlock = (d) => `<section style="margin:28px 0">
<h2 style="font-family:Sora,sans-serif;font-size:20px;margin:0 0 10px">Parking near ${esc(d.name)} — questions</h2>
${d.faqs.map(([q, a]) => `<div style="margin:14px 0">
<h3 style="font-size:15.5px;margin:0 0 4px;color:#EAF1F8">${esc(q)}</h3>
<p style="color:rgba(234,241,248,.72);margin:0;line-height:1.6">${esc(a)}</p>
</div>`).join('')}
</section>`;

const spotsBlock = (d, rows) => `<section style="margin:32px 0;padding:20px;border:1px solid rgba(255,255,255,.12);border-radius:16px;background:rgba(255,255,255,.04)">
<h2 style="font-family:Sora,sans-serif;font-size:20px;margin:0">Where to park near ${esc(d.name)}</h2>
<p style="color:rgba(234,241,248,.72);line-height:1.6;margin:8px 0 0">${esc(d.lede)}</p>
<ul style="list-style:none;padding:0;margin:14px 0 0">${rows.map(spotRow).join('')}</ul>
<p style="color:rgba(234,241,248,.45);font-size:12px;margin:14px 0 0">
Walking times are straight-line estimates from ${esc(d.name)} (${esc(d.postcode)}).
Restrictions change &mdash; check the signs on arrival. Last updated ${esc(prettyToday)}.
</p>
<p style="margin:16px 0 0"><a href="https://parkeasy.uk/?area=${esc(d.slug)}" style="display:inline-block;background:linear-gradient(135deg,#54E6D8,#2ED3C6);color:#06231F;font-weight:800;padding:12px 20px;border-radius:12px;text-decoration:none">See these on the map &rarr;</a></p>
</section>`;

const schemaFor = (d, rows) => {
  const faq = {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: d.faqs.map(([q, a]) => ({
      '@type': 'Question', name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  };
  const facilities = rows.filter(r => isFacility(r.spot)).map(r => ({
    '@context': 'https://schema.org',
    '@type': 'ParkingFacility',
    name: r.spot.name,
    geo: { '@type': 'GeoCoordinates', latitude: r.spot.lat, longitude: r.spot.lng },
    ...(r.spot.spaces ? { maximumAttendeeCapacity: r.spot.spaces } : {}),
    ...(r.spot.restriction ? { openingHours: r.spot.restriction } : {}),
    isAccessibleForFree: r.spot.badge === 'free' && !r.spot.price,
    address: { '@type': 'PostalAddress', addressLocality: 'Belfast', addressCountry: 'GB' },
    ...(r.spot.price ? { priceRange: r.spot.price } : {}),
  }));
  return [faq, ...facilities]
    .map(o => `<script type="application/ld+json">\n${jsonLd(o)}\n</script>`)
    .join('\n');
};

if (!existsSync(DIR)) {
  console.warn('inject-destination-pages: no dist/area — skipping');
  process.exit(0);
}

let upgraded = 0;
const skipped = [];
for (const d of DESTINATIONS) {
  const file = `${DIR}/${d.slug}.html`;
  if (!existsSync(file)) { skipped.push(`${d.slug} — no such page`); continue; }

  const rows = nearestPublishable(all, d, { radiusM: RADIUS_M, limit: LIMIT });
  // A page with nothing real to say stays noindexed. That is the whole
  // argument of this file, so it has to hold for the page itself too.
  if (rows.length < 3) { skipped.push(`${d.slug} — only ${rows.length} publishable spots within ${RADIUS_M}m`); continue; }

  let html = readFileSync(file, 'utf8');
  if (html.includes('id="pe-destination"')) { skipped.push(`${d.slug} — already injected`); continue; }

  const body = `<div id="pe-destination">\n${spotsBlock(d, rows)}\n${faqBlock(d)}\n${schemaFor(d, rows)}\n</div>`;

  // Before </footer>'s parent closes — after the existing copy, so the
  // page still reads as it did and gains the detail underneath.
  const at = html.lastIndexOf('<footer');
  if (at < 0) { skipped.push(`${d.slug} — no <footer> marker`); continue; }
  html = html.slice(0, at) + body + '\n' + html.slice(at);

  // The gem check runs on the FINISHED page, prose and all.
  const leaked = [...gemNames].filter(n => html.includes(n));
  if (leaked.length) {
    throw new Error(
      `inject-destination-pages: ${d.slug}.html names ${leaked.length} hidden gem(s) — `
      + `${leaked.slice(0, 3).join(', ')}. Gems are what Premium sells and this page is built `
      + 'to be crawled. Remove the name from src/data/destinations.js.',
    );
  }

  // LAST, and only now: let it be indexed. Also give it a dateModified so the
  // freshness claim on the page is machine-readable.
  html = html.replace(/\s*<meta name="robots" content="noindex,follow"\/?>\n?/, '\n');
  html = html.replace(
    /("@type":"WebPage")/,
    `$1,"dateModified":"${today}"`,
  );

  writeFileSync(file, html);
  upgraded++;
  console.log(`inject-destination-pages: ${d.slug} — ${rows.length} spots, ${d.faqs.length} FAQs, indexable`);
}

console.log(`inject-destination-pages: ${upgraded} of ${DESTINATIONS.length} destination pages upgraded`);
for (const s of skipped) console.warn(`inject-destination-pages: SKIPPED ${s}`);
