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
// ONE FUNCTION, THREE ROUTES. vercel.json rewrites /events, /events/:slug and
// /venue/:slug here; the slug is read from the query. Keeping them together is
// what stops the three pages disagreeing about a tier colour, a slug, or how
// far away a space is.
import {
  SITE, HORIZON_DAYS, tierOf, esc, jsonLd,
  timeLocal, dayLocal, fullLocal, groupByDate, fetchUpcoming, fetchBySlug,
  HEAD_CSS, topBar, pageFoot, parkNear, listSpaceNear, distanceLabel,
  fetchVenue, fetchVenueEvents, venueFromEvents, venuePlace, parkAtVenue,
} from './_eventsView.js';
import { venueMap, offsetM, bearingWord } from './_venueMap.js';
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
 * The bookable-spaces panel, written once for both page types.
 *
 * WHY IT IS SHARED. This file's own header says the three routes live together
 * so they cannot disagree about "how far away a space is" — and until now the
 * two panels were a copy of each other, differing only in the Book href. The
 * numbering added here has to match the numbering in the diagram above it on
 * both pages, which is one more thing a copy would eventually get wrong.
 *
 * THE NUMBER IS THE POINT. Each row carries the same index as its dot in
 * venueMap(), so "2" on the diagram and "2" in the list are the same space.
 * Without that the diagram is a pattern of dots.
 */
function listingPanel(place, listings, href) {
  const rows = listings.map((l, i) => {
    const o = offsetM(place.lat, place.lng, l.lat, l.lng);
    const dir = o ? bearingWord(o.e, o.n, l.d) : null;
    return `
    <div class="listing">
      <span class="info">
        <span class="nm"><span aria-hidden="true" style="display:inline-block;min-width:18px;
          height:18px;line-height:18px;text-align:center;border-radius:6px;
          background:rgba(46,211,198,.18);color:#5BE7DA;font-size:11px;font-weight:700;
          margin-right:7px">${i + 1}</span>${esc(l.title || 'Private space')}</span>
        <span class="dist" style="display:block">${esc(distanceLabel(l.d))}${
          dir ? ` &middot; ${esc(dir)} of ${esc(place.venue_name || place.name || 'the venue')}` : ''
        } &middot; ${esc(priceLabel(l))}</span>
      </span>
      <a class="bk" href="${esc(href)}">Book</a>
    </div>`;
  }).join('');
  return `<div class="panel">
    <h3>Bookable spaces within 2km</h3>
    ${rows}
  </div>`;
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
    <p class="lede">${ev.venue_slug
      ? `<a href="/venue/${esc(ev.venue_slug)}">${esc(ev.venue_name)}</a>`
      : esc(ev.venue_name)}<br>${esc(fullLocal(ev.starts_at))}</p>
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

  ${ev.lat != null ? venueMap(ev, listings) : ''}

  ${listings.length ? listingPanel(ev, listings, parkNear(ev)) : `
  <div class="panel">
    <h3>We&#39;re recruiting hosts near this venue</h3>
    <p>There is nothing bookable within 2km of ${esc(ev.venue_name)} yet. If you have a
       driveway, yard or car park near here, it is free to list and you set the hours.</p>
    <a class="cta block" href="${esc(listSpaceNear(ev))}">List your space</a>
  </div>`}

  ${ev.parking_notes ? `<div class="panel"><h3>Parking at ${esc(ev.venue_name)}</h3>
    <p>${esc(ev.parking_notes)}</p>${ev.venue_slug
      ? `<p style="margin-top:12px"><a href="/venue/${esc(ev.venue_slug)}">Everything on at ${esc(ev.venue_name)} &rarr;</a></p>`
      : ''}</div>` : ''}
</main>`;

  return shell({
    title, description, canonical: `${SITE}/events/${ev.slug}`,
    head: `<script type="application/ld+json">${jsonLd(schema)}</script>`,
    body,
  });
}

// ── /venue/{slug} ────────────────────────────────────────────────────────────
// Everything on at one venue, and how parking there actually works.
//
// WHY THIS PAGE EXISTS. /events/{slug} answers "where do I park for this gig".
// Nothing answered "where do I park at the Ulster Hall" — which is what
// somebody types when they have tickets for something we never listed, and what
// a venue's own box office searches for. There are 16 active venues and 313
// upcoming fixtures between them, so this is the hub those 313 event pages link
// up into instead of each being an orphan.
//
// THE PARKING NOTES LEAD, NOT THE BOOKABLE SPACES. nearbyListings() returns
// only listings we can actually sell, and 13 of the 15 venues with fixtures
// have none within 2km. A bookable-first page would therefore be empty on
// almost every venue, while parking_notes is populated on all 17 rows and is
// the thing the page's own title promises to answer.
//
// NO PRECISE DISTANCES, AND NO WALKING TIMES. venues.geo_verified is false on
// 16 of 17 rows. Printing "340m, a 4 minute walk" from an unverified pin is a
// claim about accuracy nobody measured — see distanceLabel() in _eventsView.js.
//
// A VENUE WITH NO FIXTURES IS NOT INDEXED. Its page is ~90 words of parking
// notes, which is the same thin-content problem the six destination pages had
// before PR #264 gave them real spots. So it renders for anyone with the link
// and carries noindex,follow until the sweep gives it a fixture — at which
// point the next render earns the index on its own, with no deploy. The sitemap
// uses the same rule, so a URL it advertises is never one we told Googlebot to
// ignore.
function renderVenue(v, events, listings) {
  const place = venuePlace(v);
  const where = [v.town, v.postcode].filter(Boolean).join(', ');
  const cap = Number(v.capacity) > 0 ? Number(v.capacity) : null;
  const type = String(v.venue_type || '').trim();

  // Written by whoever ran the sweep, so paragraph breaks are honoured and
  // everything is escaped. A single blank line is the only structure allowed.
  const notes = String(v.parking_notes || '').split(/\n\s*\n|\n/).map(s => s.trim()).filter(Boolean);

  const soonest = events[0];
  const title = `Parking at ${v.name}${v.town ? `, ${v.town}` : ''} | ParkEasy`;
  const description = events.length
    ? `Parking at ${v.name} — ${events.length} event${events.length !== 1 ? 's' : ''} `
      + `in the next ${HORIZON_DAYS} days, starting with ${soonest.name} on `
      + `${dayLocal(soonest.starts_at)}. Where to park and what to expect.`
    : `Parking at ${v.name}${where ? `, ${where}` : ''}. Where to park, `
      + `and how to book a space nearby before you travel.`;

  const chips = [
    type ? `<span class="chip" style="color:var(--muted);background:rgba(255,255,255,.05);border:1px solid var(--hairline)">${esc(type[0].toUpperCase() + type.slice(1))}</span>` : '',
    cap ? `<span class="chip" style="color:var(--muted);background:rgba(255,255,255,.05);border:1px solid var(--hairline)">Holds ${cap.toLocaleString('en-GB')}</span>` : '',
    events.length ? `<span class="chip" style="color:var(--teal-lt);background:rgba(46,211,198,.12);border:1px solid rgba(46,211,198,.3)">${events.length} coming up</span>` : '',
  ].filter(Boolean).join('');

  // Place carries an @id so each event in the ItemList can point at it rather
  // than repeating the address 72 times.
  const placeId = `${SITE}/venue/${v.slug}#place`;
  const schema = [
    {
      '@context': 'https://schema.org', '@type': 'Place', '@id': placeId,
      name: v.name,
      url: `${SITE}/venue/${v.slug}`,
      ...(v.website_url ? { sameAs: v.website_url } : {}),
      ...(cap ? { maximumAttendeeCapacity: cap } : {}),
      ...(v.postcode || v.town ? {
        address: {
          '@type': 'PostalAddress',
          ...(v.address ? { streetAddress: v.address } : {}),
          ...(v.town ? { addressLocality: v.town } : {}),
          ...(v.postcode ? { postalCode: v.postcode } : {}),
          addressCountry: 'GB',
        },
      } : {}),
      ...(v.lat != null ? { geo: { '@type': 'GeoCoordinates', latitude: v.lat, longitude: v.lng } } : {}),
      // publicAccess is the only parking claim made here, and it is about the
      // VENUE being open to the public — not about it having a car park. A
      // ParkingFacility type would say Ulster Hall is a car park, which it is
      // not, and the private driveways nearby are not published as facilities
      // because their addresses are not ours to put in a search index.
      publicAccess: true,
    },
    // Built from the same array the page renders, so the schema can never
    // advertise an event the visitor cannot see on the page.
    ...(events.length ? [{
      '@context': 'https://schema.org', '@type': 'ItemList',
      name: `Events at ${v.name}`,
      numberOfItems: events.length,
      itemListElement: events.map((e, i) => ({
        '@type': 'ListItem', position: i + 1,
        item: {
          '@type': 'Event', name: e.name,
          startDate: e.starts_at,
          url: `${SITE}/events/${e.slug}`,
          eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
          eventStatus: 'https://schema.org/EventScheduled',
          location: { '@id': placeId },
        },
      })),
    }] : []),
  ];

  const body = `<main class="wrap">
  <div class="hero">
    <p class="kicker"><a href="/events" style="text-decoration:none">&larr; What&#39;s on</a></p>
    <h1>Parking at ${esc(v.name)}</h1>
    ${where ? `<p class="lede">${esc(where)}</p>` : ''}
    ${chips ? `<div class="meta">${chips}</div>` : ''}
    ${v.lat != null ? `<a class="cta block" href="${esc(parkAtVenue(v))}">Find parking near ${esc(v.name)}</a>` : ''}
  </div>

  ${notes.length ? `<div class="panel">
    <h3>What to know before you drive</h3>
    ${notes.map(n => `<p>${esc(n)}</p>`).join('')}
  </div>` : ''}

  ${v.lat != null ? venueMap(place, listings) : ''}

  ${listings.length ? listingPanel(place, listings, parkAtVenue(v)) : `
  <div class="panel">
    <h3>We&#39;re recruiting hosts near ${esc(v.name)}</h3>
    <p>There is nothing bookable within 2km of ${esc(v.name)} yet. If you have a
       driveway, yard or car park near here, it is free to list and you set the hours
       &mdash; including closing it on the nights you want your own space.</p>
    <a class="cta block" href="${esc(listSpaceNear(place))}">List your space</a>
  </div>`}

  ${events.length ? `
  <section class="daygroup" style="margin-top:34px">
    <h2>What&#39;s on at ${esc(v.name)}</h2>
    <p class="empty" style="margin-bottom:4px">Next ${HORIZON_DAYS} days. Times are Belfast local.</p>
    ${events.map(e => `
    <a class="card" href="/events/${esc(e.slug)}">
      <div class="row1">
        <span class="when">${esc(timeLocal(e.starts_at))}</span>
        <span style="flex:1;min-width:0">
          <h3>${esc(e.name)}</h3>
          <p class="venue">${esc(dayLocal(e.starts_at))}${e.subtitle ? ` &middot; ${esc(e.subtitle)}` : ''}</p>
        </span>
      </div>
      <div class="meta">${chip(e.demand_tier)}${e.expected_attendance
        ? `<span class="chip" style="color:var(--muted);background:rgba(255,255,255,.05);border:1px solid var(--hairline)">~${Number(e.expected_attendance).toLocaleString('en-GB')} expected</span>`
        : ''}${e.status === 'provisional'
        ? `<span class="chip" style="color:var(--amber);background:rgba(255,194,75,.13);border:1px solid rgba(255,194,75,.32)">Date provisional</span>`
        : ''}</div>
    </a>`).join('')}
  </section>` : `
  <div class="panel">
    <h3>Nothing listed here yet</h3>
    <p>We have no fixtures on the books for ${esc(v.name)} in the next ${HORIZON_DAYS} days.
       <a href="/events">See what else is on in Belfast</a>.</p>
  </div>`}
</main>`;

  return shell({
    title, description, canonical: `${SITE}/venue/${v.slug}`,
    head: (events.length ? '' : `<meta name="robots" content="noindex,follow">\n`)
      + schema.map(s => `<script type="application/ld+json">${jsonLd(s)}</script>`).join('\n'),
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
  const venue = String(req.query?.venue || '').trim();
  try {
    if (venue) {
      // A FAILED read and an EMPTY read mean different things here. Empty is a
      // correct 404 (no such venue, or active = false). A failure means we
      // cannot see the venues table at all — most likely because anon has no
      // grant on it, which would 404 all sixteen pages while looking healthy —
      // so the venue is rebuilt from one of its own events instead. See
      // venueFromEvents().
      let v = null, readable = true;
      try { v = await fetchVenue(venue); } catch { readable = false; }
      if (!v && !readable) v = await venueFromEvents(venue).catch(() => null);
      if (!v) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        return res.status(404).send(errorPage('404', "We don't have that venue",
          'We could not find that venue. It may have been renamed, or closed.'));
      }
      // Both are optional content: a venue page is still worth serving with
      // just its parking notes if the events query or the listings query
      // fails, and a half page beats a 503 to somebody standing in a car park.
      const place = venuePlace(v);
      const [events, listings] = await Promise.all([
        fetchVenueEvents(v.slug).catch(() => []),
        v.lat != null ? nearbyListings(place).catch(() => []) : Promise.resolve([]),
      ]);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', CACHE);
      return res.status(200).send(renderVenue(v, events, listings));
    }
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

export { renderList, renderEvent, renderVenue, nearbyListings, metres };
