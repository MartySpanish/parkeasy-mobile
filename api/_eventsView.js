// Everything /events and /events/{slug} both need: the query, the grouping, the
// date formatting and the shared chrome.
//
// ONE MODULE, because the two pages have to agree. A demand tier that is red on
// the listing and orange on the detail page is worse than no chip at all, and
// the listing links to the detail page by a slug both sides have to spell the
// same way.
//
// ALL TIMES ARE EUROPE/LONDON. starts_at is timestamptz, so it arrives as UTC
// and formatting it with the server's own clock would put a 7:30pm kickoff at
// 6:30pm for half the year. Every format below pins the zone explicitly.
import { selectPublic } from './_supabase.js';

export const SITE = 'https://parkeasy.uk';
export const HORIZON_DAYS = 90;

// ── Demand tiers ─────────────────────────────────────────────────────────────
// The colours are the app's own semantic accents (src/App.jsx TYPE_BADGES and
// BADGES), not a new palette: red/amber/yellow/grey reads as severity, which is
// exactly what demand is to somebody deciding when to leave the house.
//
// The BANDS are set in supabase/migrations — the weekly sweep prompt assigns a
// tier from expected attendance. They are repeated here only to be printed in
// docs/events.md and shown on the page, never to re-derive a tier: the database
// column is the truth, because a human can override it for a fixture that draws
// badly for its size.
export const TIERS = {
  major:  { label: 'Major',  from: 15000, blurb: '15,000+',        fg: '#FF8B8B', bg: 'rgba(255,90,90,.13)',  bd: 'rgba(255,90,90,.32)' },
  high:   { label: 'High',   from: 5000,  blurb: '5,000–15,000',   fg: '#FFB067', bg: 'rgba(255,140,60,.13)', bd: 'rgba(255,140,60,.32)' },
  medium: { label: 'Medium', from: 1500,  blurb: '1,500–5,000',    fg: '#FFD27A', bg: 'rgba(255,194,75,.13)', bd: 'rgba(255,194,75,.32)' },
  low:    { label: 'Low',    from: 0,     blurb: 'under 1,500',    fg: '#aebfd4', bg: 'rgba(255,255,255,.06)', bd: 'rgba(255,255,255,.14)' },
};
export const tierOf = (t) => TIERS[String(t || '').toLowerCase()] || TIERS.low;

// ── Escaping ─────────────────────────────────────────────────────────────────
// Event names, venue names and notes are written by whoever ran the weekly
// sweep and are interpolated straight into HTML. An apostrophe in "Féile an
// Phobail" is harmless; a stray angle bracket in a scraped title is not.
export const esc = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
// For a value going inside a <script type="application/ld+json"> block, where
// the only real danger is closing the tag early.
export const jsonLd = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c');

// ── Europe/London formatting ─────────────────────────────────────────────────
const fmt = (opts) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', ...opts });
export const timeLocal = (iso) => fmt({ hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
export const dayLocal  = (iso) => fmt({ weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(iso));
export const fullLocal = (iso) => fmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
/** The Europe/London calendar date, as YYYY-MM-DD — the key everything groups by. */
export const dayKey = (iso) => fmt({ year: 'numeric', month: '2-digit', day: '2-digit' })
  .format(new Date(iso)).split('/').reverse().join('-');

// ── Grouping ─────────────────────────────────────────────────────────────────
/**
 * Today / Tomorrow / This weekend / then one group per day.
 *
 * "This weekend" is the coming Saturday and Sunday, and it only appears when
 * today is NOT itself the weekend — on a Saturday, "this weekend" and "today"
 * would fight over the same events, and "Today" is the more useful of the two.
 * An event never appears in two groups: the first bucket that claims it wins.
 *
 * @param {Array<object>} rows ordered by starts_at
 * @param {Date} now injected so this is testable without freezing the clock
 */
export function groupByDate(rows, now = new Date()) {
  const today = dayKey(now.toISOString());
  const tomorrow = dayKey(new Date(now.getTime() + 86400000).toISOString());
  // Day-of-week in London, 0=Sun..6=Sat.
  const dow = Number(fmt({ weekday: 'short' }).format(now) === 'Sun' ? 0
    : ['Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(fmt({ weekday: 'short' }).format(now)) + 1);
  const isWeekendNow = dow === 0 || dow === 6;
  const satOffset = (6 - dow + 7) % 7;
  const weekend = isWeekendNow ? new Set() : new Set([
    dayKey(new Date(now.getTime() + satOffset * 86400000).toISOString()),
    dayKey(new Date(now.getTime() + (satOffset + 1) * 86400000).toISOString()),
  ]);

  const groups = new Map();
  const push = (key, label, row) => {
    if (!groups.has(key)) groups.set(key, { key, label, events: [] });
    groups.get(key).events.push(row);
  };
  for (const row of rows) {
    const k = dayKey(row.starts_at);
    if (k === today)          push('today',    'Today', row);
    else if (k === tomorrow)  push('tomorrow', 'Tomorrow', row);
    else if (weekend.has(k))  push('weekend',  'This weekend', row);
    else                      push(k, dayLocal(row.starts_at), row);
  }
  return [...groups.values()];
}

// ── The query ────────────────────────────────────────────────────────────────
const COLS = 'slug,name,subtitle,category,starts_at,doors_at,expected_attendance,'
           + 'demand_tier,status,ticket_url,venue_slug,venue_name,postcode,lat,lng,'
           + 'venue_capacity,parking_notes,days_away,bookable_spaces_within_2km';

/** Every event in the window, soonest first. Cancelled ones are left out. */
export function fetchUpcoming(limit = 400) {
  const from = new Date().toISOString();
  const to   = new Date(Date.now() + HORIZON_DAYS * 86400000).toISOString();
  return selectPublic(
    `upcoming_events?select=${COLS}`
    + `&starts_at=gte.${from}&starts_at=lt.${to}`
    + `&status=neq.cancelled&order=starts_at.asc&limit=${limit}`,
  );
}

/** One event by slug, or null. */
export async function fetchBySlug(slug) {
  const rows = await selectPublic(
    `upcoming_events?select=${COLS}&slug=eq.${encodeURIComponent(slug)}&limit=1`);
  return rows?.[0] || null;
}

// ── Shared chrome ────────────────────────────────────────────────────────────
// Lifted from public/hosts.html, which lifted it from src/theme/tokens.js. Same
// tokens, same Manrope, same card/chip/button shapes — no new design system.
export const HEAD_CSS = `
  :root{
    --bg:#0a111e; --sheet:#0d1626; --surface:#111d31; --hairline:rgba(255,255,255,0.10);
    --ink:#EAF1F8; --muted:#aebfd4; --faint:#6b7d96;
    --teal:#2ED3C6; --teal-lt:#5BE7DA; --teal-ink:#06231f;
    --green:#34E0A0; --amber:#FFC24B;
  }
  *{box-sizing:border-box}
  html{-webkit-text-size-adjust:100%}
  body{margin:0;background:var(--bg);color:var(--ink);
    font-family:Manrope,system-ui,-apple-system,'Segoe UI',sans-serif;
    font-size:16px;line-height:1.6;-webkit-font-smoothing:antialiased}
  a{color:var(--teal-lt)}
  .wrap{max-width:680px;margin:0 auto;padding:0 20px}
  h1,h2,h3{margin:0;letter-spacing:-.02em;text-wrap:balance;font-weight:800}
  header.top{border-bottom:1px solid var(--hairline);background:var(--sheet)}
  header.top .wrap{display:flex;align-items:center;gap:12px;padding-top:14px;padding-bottom:14px}
  .brand{display:flex;align-items:center;gap:9px;font-weight:800;font-size:17px;color:var(--ink);text-decoration:none}
  .brand span.dot{width:28px;height:28px;border-radius:9px;flex-shrink:0;
    background:linear-gradient(135deg,var(--teal-lt),var(--teal));
    display:inline-flex;align-items:center;justify-content:center;color:var(--teal-ink);font-size:15px}
  .top a.back{margin-left:auto;font-size:13.5px;font-weight:700;text-decoration:none}
  .hero{padding:40px 0 26px}
  .kicker{font-size:11.5px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;
    color:var(--teal-lt);margin:0 0 12px}
  .hero h1{font-size:clamp(28px,7vw,42px);line-height:1.08}
  .hero p.lede{font-size:17px;color:var(--muted);margin:14px 0 0}
  .cta{display:inline-block;background:linear-gradient(135deg,var(--teal-lt),var(--teal));
    color:var(--teal-ink);font-weight:800;font-size:15.5px;padding:14px 24px;border-radius:14px;
    text-decoration:none;min-height:48px}
  .cta.ghost{background:none;border:1px solid var(--hairline);color:var(--ink)}
  .cta.block{display:block;text-align:center;margin-top:20px}
  .daygroup{padding:26px 0 0;border-top:1px solid var(--hairline);margin-top:26px}
  .daygroup:first-of-type{border-top:0;margin-top:0}
  .daygroup h2{font-size:clamp(19px,4.2vw,24px)}
  .card{display:block;background:var(--surface);border:1px solid var(--hairline);
    border-radius:16px;padding:16px;margin-top:12px;text-decoration:none;color:inherit}
  .card .row1{display:flex;align-items:flex-start;gap:12px}
  .card .when{font-variant-numeric:tabular-nums;font-weight:800;font-size:15px;color:var(--teal-lt);
    min-width:52px;flex-shrink:0}
  .card h3{font-size:16.5px;line-height:1.25}
  .card .venue{color:var(--muted);font-size:13.5px;margin-top:2px}
  .chip{display:inline-flex;align-items:center;font-size:11px;font-weight:800;
    padding:3px 9px;border-radius:999px;white-space:nowrap;letter-spacing:.02em}
  .card .go{margin-top:11px;font-size:13px;font-weight:800;color:var(--teal-lt)}
  .meta{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px;align-items:center}
  .panel{background:var(--surface);border:1px solid var(--hairline);border-radius:16px;padding:18px;margin-top:20px}
  .panel h3{font-size:16px}
  .panel p{color:var(--muted);margin:8px 0 0;font-size:14.5px}
  .listing{display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--hairline)}
  .listing:last-child{border-bottom:0}
  .listing .info{flex:1;min-width:0}
  .listing .nm{font-weight:700;font-size:14.5px}
  .listing .dist{color:var(--faint);font-size:12.5px}
  .listing .bk{background:linear-gradient(135deg,var(--teal-lt),var(--teal));color:var(--teal-ink);
    font-weight:800;font-size:13px;padding:9px 16px;border-radius:11px;text-decoration:none;flex-shrink:0}
  .mapwrap{margin-top:20px;border-radius:16px;overflow:hidden;border:1px solid var(--hairline);
    background:var(--sheet)}
  footer{padding:34px 0 44px;border-top:1px solid var(--hairline);margin-top:34px;
    color:var(--faint);font-size:12.5px;text-align:center}
  .empty{color:var(--muted);margin-top:16px}
`;

export const topBar = () => `<header class="top"><div class="wrap">
  <a class="brand" href="/"><span class="dot">P</span>ParkEasy</a>
  <a class="back" href="/">Find parking &rarr;</a>
</div></header>`;

export const pageFoot = () => `<footer><div class="wrap">
  <p>Event times are Belfast local. Listings and crowd figures are estimates &mdash;
     check the venue for the final word.</p>
  <p style="margin-top:10px"><a href="/">ParkEasy</a> &middot;
     <a href="/events">What&#39;s on</a> &middot;
     <a href="/hosts">List your space</a></p>
</div></footer>`;

/**
 * The deep link that answers "find parking near here".
 *
 * There is no /park/{venue_slug} route in this codebase — the parking finder IS
 * the app — so these CTAs open the app already searched at the venue, which is
 * the same result that page would have produced. `event` is carried through so
 * the app can tell where the visit came from.
 */
export const parkNear = (ev) =>
  `/?near=${ev.lat},${ev.lng}&place=${encodeURIComponent(ev.venue_name || '')}`
  + `&event=${encodeURIComponent(ev.slug)}`;

export const listSpaceNear = (ev) => `/hosts?venue=${encodeURIComponent(ev.venue_slug || '')}`;
