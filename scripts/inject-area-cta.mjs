// Build step: put something to BUY on every area page.
//
// The problem this fixes. /area/belfast.html — the page every social post
// pointed at — named Victoria Square, CastleCourt, Q-Park, NCP, Titanic and
// the SSE, and did not mention a single space ParkEasy can sell. It had no
// booking control of any kind. We were paying for traffic and handing it to
// competitors.
//
// This injects, into each pre-rendered area page:
//   1. A booking block naming the real bookable spaces in that town, with the
//      all-in price and a CTA into the app.
//   2. Offer/Product JSON-LD so Google can see there is inventory with prices,
//      rather than reading the page as a directory listing other people's
//      car parks.
//   3. A commercial CTA even where we have no inventory yet — "list your
//      space" — so no page is a dead end.
//
// Runs after prerender, over dist/area/*.html. Never fails the build: a
// missing marker is reported and skipped, because a broken deploy costs more
// than an un-upgraded page.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { spacesForArea, gbp, EXPIRED_SPACES } from '../src/data/bookableSpaces.js';

const DIR = 'dist/area';
if (!existsSync(DIR)) {
  console.warn('inject-area-cta: no dist/area — skipping');
  process.exit(0);
}

const esc = (s) => String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

// "2026-08-21" → "Friday 21 August". Noon UTC so the day never slips a date.
const prettyDate = (ymd) => new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-GB',
  { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

const bookingBlock = (spaces, town) => {
  if (!spaces.length) {
    // No inventory here yet. Still ask for the thing that creates it, and
    // still tell the reader this is a place you can book, not just browse.
    return `<section style="margin:32px 0;padding:20px;border:1px solid rgba(91,231,218,.35);border-radius:16px;background:linear-gradient(135deg,rgba(46,211,198,.10),rgba(91,231,218,.04))">
<h2 style="font-family:Sora,sans-serif;font-size:20px;margin:0">Book a guaranteed space</h2>
<p style="color:rgba(234,241,248,.72);line-height:1.6;margin:8px 0 0">ParkEasy lets you reserve and pay for a space in advance at school, church and GAA club car parks across Northern Ireland — held for you when you arrive. We don't have a bookable space in ${esc(town)} yet.</p>
<p style="margin:16px 0 0"><a href="https://parkeasy.uk/?tab=spaces" style="display:inline-block;background:linear-gradient(135deg,#54E6D8,#2ED3C6);color:#06231F;font-weight:800;padding:12px 20px;border-radius:12px;text-decoration:none">Rent out your driveway or car park →</a></p>
</section>`;
  }
  const cards = spaces.map(s => `<li style="list-style:none;margin:12px 0;padding:16px;border:1px solid rgba(255,255,255,.12);border-radius:14px;background:rgba(255,255,255,.03)">
<h3 style="font-family:Sora,sans-serif;font-size:17px;margin:0">${esc(s.name)}</h3>
<p style="color:rgba(234,241,248,.62);margin:6px 0 0;font-size:14px">${esc(s.address)}, ${esc(s.postcode)} · ${s.spaces} spaces · gates ${esc(s.hours)}</p>
${s.bookableUntil ? `<p style="color:#FFD27A;margin:6px 0 0;font-size:13px;font-weight:700">Bookable up to ${esc(prettyDate(s.bookableUntil))}</p>` : ''}
<p style="margin:10px 0 0;font-size:20px;font-weight:800;color:#6BEFB9">${gbp(s.allInPence)} <span style="font-size:13px;font-weight:600;color:rgba(234,241,248,.6)">per ${esc(s.unit)}, all-in</span></p>
<p style="margin:12px 0 0"><a href="https://parkeasy.uk/?spot=${esc(s.slug)}" style="display:inline-block;background:linear-gradient(135deg,#54E6D8,#2ED3C6);color:#06231F;font-weight:800;padding:11px 18px;border-radius:12px;text-decoration:none">Book this space →</a></p>
</li>`).join('');

  return `<section style="margin:32px 0;padding:20px;border:1px solid rgba(91,231,218,.35);border-radius:16px;background:linear-gradient(135deg,rgba(46,211,198,.10),rgba(91,231,218,.04))">
<h2 style="font-family:Sora,sans-serif;font-size:20px;margin:0">Book a guaranteed space in ${esc(town)}</h2>
<p style="color:rgba(234,241,248,.72);line-height:1.6;margin:8px 0 12px">Reserved and paid in advance, held for you when you arrive — no circling, no meter.</p>
<ul style="margin:0;padding:0">${cards}</ul>
</section>`;
};

// Offer schema so a crawler sees purchasable inventory with a price, rather
// than a page about other companies' car parks.
const offerLd = (spaces, town) => {
  if (!spaces.length) return '';
  const items = spaces.map((s, i) => ({
    '@type': 'ListItem', position: i + 1,
    item: {
      '@type': 'Product',
      name: s.name,
      description: `Reserved parking in ${town}. ${s.spaces} spaces, gates ${s.hours}.`,
      image: s.photo || undefined,
      offers: {
        '@type': 'Offer',
        price: (s.allInPence / 100).toFixed(2),
        priceCurrency: 'GBP',
        availability: 'https://schema.org/InStock',
        // A licence with an end date is an offer with an end date. Without
        // this Google can keep showing the price after the last bookable day.
        ...(s.bookableUntil ? { priceValidUntil: s.bookableUntil } : {}),
        url: `https://parkeasy.uk/?spot=${s.slug}`,
      },
    },
  }));
  return `<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org', '@type': 'ItemList',
    name: `Bookable parking in ${town}`, itemListElement: items,
  })}</script>`;
};

let upgraded = 0, skipped = 0;
for (const file of readdirSync(DIR).filter(f => f.endsWith('.html'))) {
  const slug = file.replace('.html', '');
  const path = `${DIR}/${file}`;
  let html = readFileSync(path, 'utf8');

  if (html.includes('id="pe-book-block"')) { skipped++; continue; }   // already done

  const town = (html.match(/<h1[^>]*>Parking in ([^<]+?)(?:,|<)/i) || [])[1]?.trim()
    || slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const spaces = spacesForArea(slug);

  const block = `<div id="pe-book-block">${bookingBlock(spaces, town)}</div>${offerLd(spaces, town)}`;

  // Insert directly after the h1 so it is the first thing under the heading —
  // above the fold, and above the competitor names further down the page.
  const m = html.match(/<\/h1>/i);
  if (!m) { console.warn(`inject-area-cta: no </h1> in ${file} — skipped`); skipped++; continue; }
  html = html.replace(/<\/h1>/i, `</h1>${block}`);
  writeFileSync(path, html);
  upgraded++;
}
console.log(`inject-area-cta: ${upgraded} area pages given a booking block`
  + `${skipped ? `, ${skipped} skipped` : ''}`);
// Never drop inventory quietly — a page that stops advertising a space should
// say so in the build log, or the first anyone notices is the revenue.
for (const s of EXPIRED_SPACES)
  console.warn(`inject-area-cta: ${s.name} is PAST its window (${s.bookableUntil}) `
    + `— removed from the area pages. Extend it or take the listing down in Supabase.`);
