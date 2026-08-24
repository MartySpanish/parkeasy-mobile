// /sitemap.xml — the static pages, plus every event in the next 90 days.
//
// WHY THIS IS A FUNCTION NOW. It used to be public/sitemap.xml, a file edited by
// hand. That is fine for /hosts and the 24 area pages, which change when
// somebody writes them, and useless for events, which the weekly sweep adds to
// the database without a deploy. A hand-written file would list a fixture the
// week after it happened and never list the one next Saturday.
//
// THE STATIC LIST IS STILL A LIST, HERE. Every URL that was in the old file is
// below, verbatim, so this function is a superset of what it replaced. If
// Supabase is unreachable the events section is dropped and the static pages
// are still served with a 200 — a sitemap missing its events is a bad day; a
// sitemap returning 503 to Googlebot is a worse one.
//
// Priorities: an event within a week outranks the area pages, because it is the
// page most likely to be searched right now and the one that goes stale
// soonest. Beyond that it decays to 0.5.
import { fetchUpcoming, SITE } from './_eventsView.js';

const STATIC = [
  { loc: '/', changefreq: 'weekly', priority: '1.0' },
  { loc: '/area/belfast.html', changefreq: 'weekly', priority: '0.8' },
  { loc: '/area/derry.html', changefreq: 'weekly', priority: '0.8' },
  { loc: '/area/lisburn.html', changefreq: 'weekly', priority: '0.8' },
  { loc: '/area/newtownabbey.html', changefreq: 'weekly', priority: '0.8' },
  { loc: '/area/bangor.html', changefreq: 'weekly', priority: '0.8' },
  { loc: '/area/newry.html', changefreq: 'weekly', priority: '0.8' },
  { loc: '/area/antrim.html', changefreq: 'weekly', priority: '0.8' },
  { loc: '/area/ballymena.html', changefreq: 'weekly', priority: '0.8' },
  { loc: '/area/coleraine.html', changefreq: 'weekly', priority: '0.8' },
  { loc: '/area/portrush.html', changefreq: 'weekly', priority: '0.8' },
  { loc: '/area/carrickfergus.html', changefreq: 'weekly', priority: '0.8' },
  { loc: '/area/larne.html', changefreq: 'weekly', priority: '0.8' },
  { loc: '/area/enniskillen.html', changefreq: 'weekly', priority: '0.8' },
  { loc: '/area/omagh.html', changefreq: 'weekly', priority: '0.8' },
  { loc: '/area/dungannon.html', changefreq: 'weekly', priority: '0.8' },
  { loc: '/area/cookstown.html', changefreq: 'weekly', priority: '0.8' },
  { loc: '/area/strabane.html', changefreq: 'weekly', priority: '0.8' },
  { loc: '/area/downpatrick.html', changefreq: 'weekly', priority: '0.8' },
  { loc: '/area/newcastle.html', changefreq: 'weekly', priority: '0.8' },
  { loc: '/area/portadown.html', changefreq: 'weekly', priority: '0.8' },
  { loc: '/area/craigavon.html', changefreq: 'weekly', priority: '0.8' },
  { loc: '/area/ballycastle.html', changefreq: 'weekly', priority: '0.8' },
  { loc: '/area/banbridge.html', changefreq: 'weekly', priority: '0.8' },
  { loc: '/area/magherafelt.html', changefreq: 'weekly', priority: '0.8' },  // Added with the events routes. /events is a real landing page in its own
  // right — "what's on in Belfast" is the search it answers.
  { loc: '/events', changefreq: 'daily', priority: '0.9' },
  { loc: '/hosts',    changefreq: 'monthly', priority: '0.7' },
  { loc: '/partners', changefreq: 'monthly', priority: '0.6' },
  { loc: '/globe',    changefreq: 'monthly', priority: '0.5' },
];

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const ymd = (d) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(d);

const urlEl = ({ loc, changefreq, priority, lastmod }) =>
  `  <url><loc>${esc(SITE + loc)}</loc>`
  + (lastmod ? `<lastmod>${lastmod}</lastmod>` : '')
  + `<changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`;

export default async function handler(req, res) {
  const today = ymd(new Date());
  const entries = STATIC.map(s => ({ ...s, lastmod: today }));

  let degraded = false;
  try {
    const rows = await fetchUpcoming();
    for (const e of rows) {
      if (!e.slug) continue;
      const days = Number(e.days_away);
      entries.push({
        loc: `/events/${e.slug}`,
        changefreq: days <= 7 ? 'daily' : 'weekly',
        priority: days <= 7 ? '0.9' : days <= 30 ? '0.7' : '0.5',
        lastmod: today,
      });
    }
  } catch {
    degraded = true;   // static pages only — see the note at the top
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map(urlEl).join('\n')}
</urlset>
`;
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  // Ten minutes, matching the events pages. A degraded sitemap is cached for one
  // minute only, so a brief outage does not pin an events-less sitemap for ten.
  res.setHeader('Cache-Control', degraded
    ? 'public, s-maxage=60'
    : 'public, s-maxage=600, stale-while-revalidate=3600');
  return res.status(200).send(xml);
}

export { STATIC };
