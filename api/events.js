// /events and /events/{slug}, rendered on the server.
//
// WHY A FUNCTION AND NOT A BUILT PAGE. The brief asked for Next's
// `export const revalidate = 600`. There is no Next here — ParkEasy is a Vite
// SPA whose static pages (/hosts, /partners, /area/*) are written at build time
// — and a built page is the wrong shape for this data anyway: events change
// between deploys, and the weekly sweep writes new rows without one. So the
// page is rendered per request and cached at the edge for ten minutes, which is
// what revalidate=600 buys. `stale-while-revalidate` means the ten-minute-old
// copy is served instantly while the next one is built behind it, so no visitor
// ever waits on Postgres.
//
// ONE FUNCTION, TWO ROUTES. vercel.json rewrites both /events and
// /events/:slug here; the slug is read from the query. Keeping them together is
// what stops the listing and the detail page disagreeing about a tier colour or
// a slug.
import {
  SITE, HORIZON_DAYS, tierOf, esc, jsonLd,
  timeLocal, fullLocal, groupByDate, fetchUpcoming, fetchBySlug,
  HEAD_CSS, topBar, pageFoot, parkNear, listSpaceNear,
} from './_eventsView.js';
import { selectPublic } from './_supabase.js';

const CACHE = 'public, s-maxage=600, stale-while-revalidate=3600';

const shell = ({ title, description, canonical, head = '', body }) => `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:type" content="website">
<link rel="icon" href="/favicon.ico">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;600;700;800&display=swap">
${head}
<style>${HEAD_CSS}</style>
</head>
<body>
${topBar()}
${body}
${pageFoot()}
</body>
</html>`;

const chip = (t) => {
  const s = tierOf(t);
  return `<span class="chip" style="color:${s.fg};background:${s.bg};border:1px solid ${s.bd}">${s.label} demand</span>`;
};

// ── /events ──────────────────────────────────────────────────────────────────
function renderList(rows) {
  const groups = groupByDate(rows);
  // The meta description is built from the three soonest events, so the search
  // snippet says what is actually on this week rather than repeating a slogan.
  const top3 = rows.slice(0, 3).map(e => `${e.name} (${e.venue_name})`).join(', ');
  const description = rows.length
    ? `Parking for what's on in Belfast over the next ${HORIZON_DAYS} days — ${top3}. Find a space near the venue before you travel.`
    : `Parking for what's on in Belfast. Event listings and a space near the venue before you travel.`;

  const body = `<main class="wrap">
  <div class="hero">
    <p class="kicker">What&#39;s on</p>
    <h1>Belfast events, and where to park for them</h1>
    <p class="lede">${rows.length
      ? `${rows.length} event${rows.length !== 1 ? 's' : ''} in the next ${HORIZON_DAYS} days. Times are Belfast local.`
      : `Nothing is listed in the next ${HORIZON_DAYS} days yet — check back shortly.`}</p>
  </div>
  ${rows.length ? groups.map(g => `
  <section class="daygroup">
    <h2>${esc(g.label)}</h2>
    ${g.events.map(e => `
    <a class="card" href="/events/${esc(e.slug)}">
      <div class="row1">
        <span class="when">${esc(timeLocal(e.starts_at))}</span>
        <span style="flex:1;min-width:0">
          <h3>${esc(e.name)}</h3>
          <p class="venue">${esc(e.venue_name)}${e.subtitle ? ` &middot; ${esc(e.subtitle)}` : ''}</p>
        </span>
      </div>
      <div class="meta">${chip(e.demand_tier)}${e.expected_attendance
        ? `<span class="chip" style="color:var(--muted);background:rgba(255,255,255,.05);border:1px solid var(--hairline)">~${Number(e.expected_attendance).toLocaleString('en-GB')} expected</span>`
        : ''}</div>
      <p class="go">Find parking near ${esc(e.venue_name)} &rarr;</p>
    </a>`).join('')}
  </section>`).join('') : `<p class="empty">No events are listed for the next ${HORIZON_DAYS} days.</p>`}
</main>`;

  return shell({
    title: "What's on in Belfast — parking guide | ParkEasy",
    description,
    canonical: `${SITE}/events`,
    body,
  });
}

// ── /events/{slug} ───────────────────────────────────────────────────────────
const R = 6371000;
const metres = (aLat, aLng, bLat, bLng) => {
  const p = Math.PI / 180;
  const dLat = (bLat - aLat) * p, dLng = (bLng - aLng) * p;
  const h = Math.sin(dLat / 2) ** 2
          + Math.cos(aLat * p) * Math.cos(bLat * p) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

/**
 * Bookable spaces near the venue.
 *
 * rental_listings is the same table the app reads for bookable spaces, and the
 * same status=active filter. Distance is computed here rather than in SQL
 * because the column is plain lat/lng with no PostGIS index — at this row count
 * that is nothing, and it avoids adding an extension to production for a
 * listing page.
 */
async function nearbyListings(ev, max = 6) {
  const rows = await selectPublic(
    'rental_listings?select=id,title,address,lat,lng,price_per_hour,price_per_day'
    + '&status=eq.active&limit=200');
  return rows
    .filter(l => l.lat != null && l.lng != null)
    .map(l => ({ ...l, d: metres(ev.lat, ev.lng, l.lat, l.lng) }))
    .filter(l => l.d <= 2000)
    .sort((a, b) => a.d - b.d)
    .slice(0, max);
}

const priceLabel = (l) => {
  const h = Number(l.price_per_hour) > 0 ? `£${Number(l.price_per_hour).toFixed(2)}/hr` : null;
  const d = Number(l.price_per_day)  > 0 ? `£${Number(l.price_per_day).toFixed(2)}/day` : null;
  return [h, d].filter(Boolean).join(' · ') || 'See price';
};

/**
 * A static map with a 500m ring.
 *
 * staticmap.openstreetmap.de is already in the site's img-src CSP, so no new
 * origin is introduced and no map library ships to a page that only needs a
 * picture. The ring is a CSS circle sized from the projection rather than baked
 * into the image: at zoom z a pixel is 156543.03 * cos(lat) / 2^z metres, so
 * 500m is that many pixels across whatever the tile server returns.
 */
function staticMap(ev) {
  const ZOOM = 14, W = 620, H = 320;
  const mPerPx = 156543.03392 * Math.cos(ev.lat * Math.PI / 180) / Math.pow(2, ZOOM);
  const r = Math.round(500 / mPerPx);
  const src = `https://staticmap.openstreetmap.de/staticmap.php`
    + `?center=${ev.lat},${ev.lng}&zoom=${ZOOM}&size=${W}x${H}&maptype=mapnik`
    + `&markers=${ev.lat},${ev.lng},lightblue1`;
  return `<div class="mapwrap" style="position:relative;aspect-ratio:${W}/${H}">
    <img src="${esc(src)}" width="${W}" height="${H}" loading="lazy"
         alt="Map showing ${esc(ev.venue_name)} and the area within 500 metres"
         style="display:block;width:100%;height:100%;object-fit:cover">
    <span aria-hidden="true" style="position:absolute;left:50%;top:50%;
      width:${r * 2}px;height:${r * 2}px;margin:-${r}px 0 0 -${r}px;border-radius:50%;
      border:2px solid rgba(46,211,198,.85);background:rgba(46,211,198,.12);
      max-width:96%;max-height:96%"></span>
  </div>
  <p style="color:var(--faint);font-size:12px;margin:8px 0 0">
    Ring is roughly 500m around ${esc(ev.venue_name)}. Map &copy; OpenStreetMap contributors.</p>`;
}

function renderEvent(ev, listings) {
  const attend = ev.expected_attendance
    ? `~${Number(ev.expected_attendance).toLocaleString('en-GB')} expected` : null;
  const title = `Parking for ${ev.name} at ${ev.venue_name} | ParkEasy`;
  const description = `${ev.name} at ${ev.venue_name}, ${fullLocal(ev.starts_at)}.`
    + `${attend ? ` ${attend}.` : ''} Book a space near the venue before you travel.`;

  const schema = {
    '@context': 'https://schema.org', '@type': 'Event',
    name: ev.name,
    startDate: ev.starts_at,
    // Google reads this literally: a cancelled event left as Scheduled keeps
    // sending people to a venue that is shut. The listing filters cancelled
    // rows out, but a direct link to this page does not, so it is mapped here.
    eventStatus: ev.status === 'cancelled'
      ? 'https://schema.org/EventCancelled'
      : 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    url: `${SITE}/events/${ev.slug}`,
    ...(ev.subtitle ? { description: ev.subtitle } : {}),
    ...(ev.doors_at ? { doorTime: ev.doors_at } : {}),
    ...(ev.expected_attendance ? { maximumAttendeeCapacity: ev.expected_attendance } : {}),
    location: {
      '@type': 'Place', name: ev.venue_name,
      ...(ev.postcode ? { address: { '@type': 'PostalAddress', postalCode: ev.postcode, addressLocality: 'Belfast', addressCountry: 'GB' } } : {}),
      ...(ev.lat != null ? { geo: { '@type': 'GeoCoordinates', latitude: ev.lat, longitude: ev.lng } } : {}),
    },
    ...(ev.ticket_url ? { offers: { '@type': 'Offer', url: ev.ticket_url, availability: 'https://schema.org/InStock' } } : {}),
  };

  const body = `<main class="wrap">
  <div class="hero">
    <p class="kicker"><a href="/events" style="text-decoration:none">&larr; What&#39;s on</a></p>
    <h1>${esc(ev.name)}</h1>
    <p class="lede">${esc(ev.venue_name)}<br>${esc(fullLocal(ev.starts_at))}</p>
    ${ev.status === 'cancelled' ? `<div class="panel" style="border-color:rgba(255,90,90,.4)">
      <h3 style="color:#FF8B8B">This event has been cancelled</h3>
      <p>Please check with the venue before travelling.</p></div>` : ''}
    <div class="meta">${chip(ev.demand_tier)}${attend
      ? `<span class="chip" style="color:var(--muted);background:rgba(255,255,255,.05);border:1px solid var(--hairline)">${esc(attend)}</span>`
      : ''}${ev.status === 'provisional'
      ? `<span class="chip" style="color:var(--amber);background:rgba(255,194,75,.13);border:1px solid rgba(255,194,75,.32)">Date provisional</span>`
      : ''}</div>
    ${ev.status === 'cancelled' ? '' :
      `<a class="cta block" href="${esc(parkNear(ev))}">Book parking near ${esc(ev.venue_name)}</a>`}
  </div>

  ${ev.lat != null ? staticMap(ev) : ''}

  ${listings.length ? `
  <div class="panel">
    <h3>Bookable spaces within 2km</h3>
    ${listings.map(l => `
    <div class="listing">
      <span class="info">
        <span class="nm">${esc(l.title || 'Private space')}</span>
        <span class="dist" style="display:block">${Math.round(l.d)}m away &middot; ${esc(priceLabel(l))}</span>
      </span>
      <a class="bk" href="${esc(parkNear(ev))}">Book</a>
    </div>`).join('')}
  </div>` : `
  <div class="panel">
    <h3>We&#39;re recruiting hosts near this venue</h3>
    <p>There is nothing bookable within 2km of ${esc(ev.venue_name)} yet. If you have a
       driveway, yard or car park near here, it is free to list and you set the hours.</p>
    <a class="cta block" href="${esc(listSpaceNear(ev))}">List your space</a>
  </div>`}

  ${ev.parking_notes ? `<div class="panel"><h3>Parking at ${esc(ev.venue_name)}</h3>
    <p>${esc(ev.parking_notes)}</p></div>` : ''}
</main>`;

  return shell({
    title, description, canonical: `${SITE}/events/${ev.slug}`,
    head: `<script type="application/ld+json">${jsonLd(schema)}</script>`,
    body,
  });
}

const errorPage = (code, heading, note) => shell({
  title: `${heading} | ParkEasy`, description: note, canonical: `${SITE}/events`,
  body: `<main class="wrap"><div class="hero">
    <p class="kicker">${code}</p><h1>${esc(heading)}</h1>
    <p class="lede">${esc(note)}</p>
    <a class="cta" style="margin-top:22px" href="/events">See what&#39;s on</a>
  </div></main>`,
});

export default async function handler(req, res) {
  const slug = String(req.query?.slug || '').trim();
  try {
    if (slug) {
      const ev = await fetchBySlug(slug);
      if (!ev) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        // No cache on a 404: the weekly sweep adds events continuously, and a
        // cached "not found" would outlive the row appearing.
        res.setHeader('Cache-Control', 'no-store');
        return res.status(404).send(errorPage('404', 'That event has moved on',
          'We could not find that event. It may have passed, or been cancelled.'));
      }
      // A listings failure must not take the page down — the event details and
      // the CTA are still worth serving.
      const listings = await nearbyListings(ev).catch(() => []);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', CACHE);
      return res.status(200).send(renderEvent(ev, listings));
    }
    const rows = await fetchUpcoming();
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', CACHE);
    return res.status(200).send(renderList(rows));
  } catch (e) {
    // Never cache an outage.
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(503).send(errorPage('503', 'Events are briefly unavailable',
      'We could not reach the events list just now. Please try again in a minute.'));
  }
}

export { renderList, renderEvent, nearbyListings, metres };
