// Build step: put the spots we actually know about onto each town page.
//
// THE PROBLEM, which is the one inject-area-cta.mjs already named for Belfast:
//
//   "/area/belfast.html — the page every social post pointed at — named
//    Victoria Square, CastleCourt, Q-Park, NCP, Titanic and the SSE, and did
//    not mention a single space ParkEasy can sell."
//
// That fix added a block for BOOKABLE inventory. There is bookable inventory in
// exactly one town. So the other twenty-three town pages are still ~475 words of
// prose naming the Tower Centre, Fairhill, The Quays and Buttercrane — competitors,
// every one — followed by "We don't have a bookable space in Ballymena yet".
//
// Meanwhile ParkEasy knows about 8 to 72 publishable spots in each of those
// towns. Ballymena has 17. Newry has 18. Not one of them appears on the page.
// We are paying for traffic to a page that recommends somebody else's car park.
//
// This is the same treatment inject-destination-pages.mjs gives the six Belfast
// destination pages, applied to the towns.
//
// WHAT IS NOT CLAIMED HERE. No distances and no walking times: a town page has
// no reference point to measure from, unlike a destination page which has a
// postcode and a lat/lng. The destination injector prints "4 min walk · 310 m"
// because it knows where you are standing. Here we do not, so it says nothing —
// rather than measuring from a town centre nobody has defined and presenting
// the result as if it were surveyed.
//
// HIDDEN GEMS ARE THE PAID PRODUCT AND MUST NEVER REACH THIS PAGE. isPublishable()
// excludes them, and the same finished-page check inject-destination-pages.mjs
// runs is repeated here: if a gem's name appears anywhere in the output, the
// build fails. A public /area page is the widest possible side door into the
// thing nine people pay for, and publishing is the one direction that cannot be
// undone.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs';
import { loadAllSpots } from './lib/loadSpots.mjs';
import { DESTINATIONS } from '../src/data/destinations.js';
// The rules — which spots, in what order, and where the CTA points — live in a
// module so they can be called with a fixture. The mutation pass is why: with
// them inline here, deleting isPublishable from the filter (which publishes
// every hidden gem in the town to an indexed page) SURVIVED the whole test
// file, because the only check that could see it read the previous build's
// output. See src/data/areaSpots.js.
import { spotsForTown, mapLink, detail, LIMIT } from '../src/data/areaSpots.js';

const DIR = 'dist/area';
if (!existsSync(DIR)) {
  console.warn('inject-area-spots: no dist/area — skipping');
  process.exit(0);
}

const esc = (s) => String(s ?? '').replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

/**
 * The six Belfast destination pages live in this same directory and are already
 * given spots, FAQs and schema by inject-destination-pages.mjs — BY COORDINATE,
 * which is the right method for a page about one building. Running over them
 * here would inject nothing while reporting success, because their spots are
 * filed under `belfast` rather than under their own slug.
 */
const DESTINATION_SLUGS = new Set(DESTINATIONS.map(d => d.slug));

const all = loadAllSpots();

// Every gem name, and every area label that is itself a gem's name — the same
// set and the same reasoning as inject-destination-pages.mjs, which found that
// "Lagan Meadows", "Wallace Park" and "Riverdale Car Park" are each one gem's
// name and another gem's `near`.
const gemNames = new Set(
  all.filter(s => s.badge === 'hidden_gem').map(s => s.name).filter(Boolean)
    .map(n => String(n).trim()).filter(n => n.length > 3),
);

const row = (s) => {
  const free = !s.price;
  return `<li style="padding:12px 0;border-top:1px solid rgba(255,255,255,.08);list-style:none">
<div style="display:flex;justify-content:space-between;gap:12px;align-items:baseline">
<strong style="color:#EAF1F8">${esc(s.name)}</strong>
<span style="color:${free ? '#6BEFB9' : 'rgba(234,241,248,.6)'};font-size:13px;white-space:nowrap">${free ? 'Free' : esc(s.price)}</span>
</div>
${detail(s) ? `<div style="color:rgba(234,241,248,.66);font-size:13.5px;margin-top:2px">${esc(detail(s))}</div>` : ''}
${s.near ? `<div style="color:rgba(234,241,248,.45);font-size:12.5px;margin-top:2px">${esc(s.near)}</div>` : ''}
</li>`;
};

const block = (town, spots, shown, total) => `<section id="pe-area-spots" style="margin:32px 0">
<h2 style="font-family:Sora,sans-serif;font-size:20px;margin:0 0 4px">Parking spots we know about in ${esc(town)}</h2>
<p style="color:rgba(234,241,248,.6);font-size:13.5px;margin:0 0 6px">${
  total > shown.length
    ? `${shown.length} of the ${total} spots in ${esc(town)} on ParkEasy. Prices and restrictions change — check the signs when you arrive.`
    : `${total} spot${total === 1 ? '' : 's'} in ${esc(town)} on ParkEasy. Prices and restrictions change — check the signs when you arrive.`
}</p>
<ul style="margin:0;padding:0">${shown.map(row).join('')}</ul>
<p style="margin:16px 0 0"><a href="${esc(mapLink(spots, town))}" style="display:inline-block;background:linear-gradient(135deg,#54E6D8,#2ED3C6);color:#06231F;font-weight:800;padding:12px 20px;border-radius:12px;text-decoration:none">${
  total > shown.length ? `See all ${total} in ${esc(town)} →` : `Open ${esc(town)} on the map →`
}</a></p>
</section>`;

let upgraded = 0;
const skipped = [];
for (const file of readdirSync(DIR).filter(f => f.endsWith('.html'))) {
  const slug = file.replace('.html', '');
  if (DESTINATION_SLUGS.has(slug)) continue;            // see DESTINATION_SLUGS
  const path = `${DIR}/${file}`;
  let html = readFileSync(path, 'utf8');

  if (html.includes('id="pe-area-spots"')) { skipped.push(`${slug} — already done`); continue; }

  const spots = spotsForTown(all, slug);
  if (!spots.length) { skipped.push(`${slug} — no publishable spots filed under this slug`); continue; }

  // The town's own name as the page states it, not a de-slugged guess — the
  // same source inject-area-cta.mjs reads, so the two blocks agree.
  const town = (html.match(/<h1[^>]*>Parking in ([^<]+?)(?:,|<)/i) || [])[1]?.trim()
    || slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  const shown = spots.slice(0, LIMIT);
  const body = block(town, spots, shown, spots.length);

  // Before the footer, so the hand-written prose still leads and this is the
  // detail underneath it — same placement as the destination pages.
  const at = html.lastIndexOf('<footer');
  if (at < 0) { skipped.push(`${slug} — no <footer> marker`); continue; }
  html = html.slice(0, at) + body + '\n' + html.slice(at);

  // On the FINISHED page, prose and all.
  const leaked = [...gemNames].filter(n => html.includes(n));
  if (leaked.length) {
    throw new Error(
      `inject-area-spots: ${file} names ${leaked.length} hidden gem(s) — `
      + `${leaked.slice(0, 3).join(', ')}. Gems are what Premium sells and this page is built `
      + 'to be crawled. isPublishable() should have excluded them.',
    );
  }

  writeFileSync(path, html);
  upgraded++;
  console.log(`inject-area-spots: ${slug} — ${shown.length}${spots.length > shown.length ? ` of ${spots.length}` : ''} spots`);
}

console.log(`inject-area-spots: ${upgraded} town pages given their own spots`);
for (const s of skipped) console.warn(`inject-area-spots: SKIPPED ${s}`);
