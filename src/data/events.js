// Event calendar for Northern Ireland, 6 Aug – 6 Nov 2026.
//
// HOW THIS WAS BUILT AND WHAT THAT MEANS FOR TRUST.
// Four researchers swept venue, club and council sources. Every external
// domain — venue sites, club sites, council sites, even Wikipedia — is blocked
// by this environment's egress proxy, so nothing was read from a primary page
// directly; it all comes from search-result summaries.
//
// That is a materially weaker basis than it sounds, and it failed loudly in
// testing: search engines repeatedly surfaced 2023–2025 programme text as
// "2026". The filter that caught it was arithmetic — checking every date
// against its real day of week. That single test eliminated five bogus events
// (Enniskillen Halloween, Mid & East Antrim Halloween, Derry Oktoberfest,
// Belfast Monster Mash, Craigavon Halloween) and a whole block of Giants
// fixtures that were last season's.
//
// RULES APPLIED HERE:
//   * Only events corroborated twice, or from the organisation's own listing.
//   * Every date verified against its weekday. No exceptions.
//   * Start times left null where sources disagreed or quoted doors rather
//     than stage time. A wrong time is worse than no time — it tells someone
//     to arrive when the car park is already full.
//   * Crowd figures only where published. Everything else is null, not a
//     guess dressed as data.
//
// DELIBERATELY ABSENT:
//   * Casement Park — CLOSED, active construction site, no fixtures in 2026.
//   * Air Waves Portrush — not running until 2028.
//   * Ulster Grand Prix — not running in 2026.
//   * Linfield's league fixtures — aggregator-sourced only, one kick-off time
//     atypical for the league, official sites unreachable. Not shippable.
//
// RE-CHECK IN MID-SEPTEMBER: council Halloween programmes for 2026 were not
// published when this was compiled, so October is the weakest month here.

// Venue coordinates. Those marked `approx` are ours, not resolved from a
// geocoder — every geocoder is blocked here too. They only position the
// parking search radius, but a wrong one shows the wrong car parks, so they
// are flagged rather than presented as fact.
export const VENUES = {
  o2:         { name: 'The O2 Belfast', aka: 'formerly the SSE Arena', lat: 54.6037, lng: -5.9170, area: 'Titanic Quarter' },
  waterfront: { name: 'Waterfront Hall', aka: 'ICC Belfast', lat: 54.5975, lng: -5.9223, area: 'Lanyon Place', approx: true },
  ulsterhall: { name: 'Ulster Hall', lat: 54.5955, lng: -5.9295, area: 'Bedford Street' },
  goh:        { name: 'Grand Opera House', lat: 54.5950, lng: -5.9338, area: 'Great Victoria Street' },
  windsor:    { name: 'Windsor Park', aka: 'National Football Stadium', lat: 54.5817, lng: -5.9548, area: 'Donegall Avenue', approx: true },
  affidea:    { name: 'Affidea Stadium', aka: 'Ravenhill, formerly Kingspan', lat: 54.5786, lng: -5.9058, area: 'Ravenhill', approx: true },
  solitude:   { name: 'Solitude', lat: 54.6183, lng: -5.9500, area: 'Cliftonville', approx: true },
  oval:       { name: 'The Oval', lat: 54.6142, lng: -5.8985, area: 'Ballymacarrett', approx: true },
  botanic:    { name: 'Botanic Gardens', lat: 54.5840, lng: -5.9330, area: 'Botanic' },
  ormeaupark: { name: 'Ormeau Park', lat: 54.5836, lng: -5.9040, area: 'Ormeau', approx: true },
  eikon:      { name: 'Eikon Exhibition Centre', lat: 54.4867, lng: -6.1094, area: 'Lisburn' },
  derrycity:  { name: 'Derry~Londonderry city centre', lat: 54.9966, lng: -7.3086, area: 'Derry~Londonderry', approx: true },
};

/**
 * date      — YYYY-MM-DD (single day) or [start, end] inclusive
 * time      — 'HH:MM' or null when sources disagreed
 * crowd     — published figure only, else null
 * closures  — true only where a closure notice exists or the event has a
 *             consistent history of one; drives the warning banner
 */
export const EVENTS = [
  // ── August ────────────────────────────────────────────────────────────────
  { id: 'fleadh-2026', name: 'Fleadh Cheoil na hÉireann', venue: 'derrycity', venueOverride: { name: 'Belfast city centre', lat: 54.6005, lng: -5.9272 },
    date: ['2026-08-02', '2026-08-09'], time: null, crowd: 800000, closures: true, tag: 'Festival' },
  { id: 'clift-crus-0807', name: 'Cliftonville v Crusaders', venue: 'solitude', date: '2026-08-07', time: '19:45', crowd: null, closures: false, tag: 'Football' },
  { id: 'giants-herlev-1', name: 'Belfast Giants v Herlev Eagles', venue: 'o2', date: '2026-08-28', time: '19:00', crowd: null, closures: false, tag: 'Ice hockey' },
  { id: 'wolfetones', name: 'The Wolfe Tones', venue: 'o2', date: '2026-08-29', time: '19:30', crowd: null, closures: false, tag: 'Concert' },
  { id: 'giants-herlev-2', name: 'Belfast Giants v Herlev Eagles', venue: 'o2', date: '2026-08-30', time: '16:00', crowd: null, closures: false, tag: 'Ice hockey' },
  { id: 'mela-day', name: 'Belfast Mela Day', venue: 'botanic', date: '2026-08-30', time: null, crowd: null, closures: false, tag: 'Festival' },

  // ── September ─────────────────────────────────────────────────────────────
  { id: 'sigurros', name: 'Sigur Rós with the Ulster Orchestra', venue: 'waterfront', date: '2026-09-04', time: '19:00', crowd: null, closures: false, tag: 'Concert' },
  { id: 'tattoo', name: 'Belfast International Tattoo', venue: 'o2', date: ['2026-09-04', '2026-09-05'], time: null, crowd: null, closures: false, tag: 'Show' },
  { id: 'waterside-half', name: 'Waterside Half Marathon', venue: 'derrycity', date: '2026-09-06', time: null, crowd: null, closures: true, tag: 'Running' },
  { id: 'freya', name: 'Freya Ridings', venue: 'ulsterhall', date: '2026-09-06', time: '19:00', crowd: null, closures: false, tag: 'Concert' },
  { id: 'mammamia', name: 'Mamma Mia! The Musical', venue: 'o2', date: ['2026-09-09', '2026-09-12'], time: null, crowd: null, closures: false, tag: 'Show' },
  { id: 'anastacia', name: 'Anastacia', venue: 'waterfront', date: '2026-09-17', time: '19:00', crowd: null, closures: false, tag: 'Concert' },
  { id: 'culture-night', name: 'Culture Night Belfast', venue: 'waterfront', venueOverride: { name: 'Cathedral Quarter', lat: 54.6010, lng: -5.9285 },
    date: '2026-09-18', time: null, crowd: null, closures: true, tag: 'Festival' },
  { id: 'giants-dundee-1', name: 'Belfast Giants v Dundee Stars', venue: 'o2', date: '2026-09-19', time: '19:00', crowd: null, closures: false, tag: 'Ice hockey' },
  { id: 'janemcdonald', name: 'Jane McDonald', venue: 'waterfront', date: ['2026-09-19', '2026-09-20'], time: null, crowd: null, closures: false, tag: 'Concert' },
  { id: 'giants-fife-1', name: 'Belfast Giants v Fife Flyers', venue: 'o2', date: '2026-09-20', time: '17:00', crowd: null, closures: false, tag: 'Ice hockey' },
  { id: 'belfast-half', name: 'Belfast City Half Marathon', venue: 'ormeaupark', date: '2026-09-20', time: null, crowd: null, closures: true, tag: 'Running' },
  { id: 'ulster-edinburgh', name: 'Ulster v Edinburgh (URC)', venue: 'affidea', date: '2026-09-25', time: '19:45', crowd: null, closures: false, tag: 'Rugby' },
  { id: 'uo-beethoven', name: 'Ulster Orchestra — Beethoven 9', venue: 'ulsterhall', date: '2026-09-25', time: '19:45', crowd: null, closures: false, tag: 'Concert' },
  { id: 'giants-fife-2', name: 'Belfast Giants v Fife Flyers', venue: 'o2', date: '2026-09-26', time: '19:00', crowd: null, closures: false, tag: 'Ice hockey' },
  { id: 'ni-hungary', name: 'Northern Ireland v Hungary', venue: 'windsor', date: '2026-09-28', time: '19:45', crowd: 18434, soldOut: true, closures: false, tag: 'Football' },

  // ── October ───────────────────────────────────────────────────────────────
  { id: 'megan-moroney', name: 'Megan Moroney', venue: 'o2', date: '2026-10-01', time: '20:00', crowd: null, closures: false, tag: 'Concert' },
  { id: 'giants-dundee-2', name: 'Belfast Giants v Dundee Stars', venue: 'o2', date: '2026-10-04', time: '17:00', crowd: null, closures: false, tag: 'Ice hockey' },
  { id: 'ni-georgia', name: 'Northern Ireland v Georgia', venue: 'windsor', date: '2026-10-05', time: '19:45', crowd: 18434, soldOut: true, closures: false, tag: 'Football' },
  { id: 'ulster-munster', name: 'Ulster v Munster (URC)', venue: 'affidea', date: '2026-10-10', time: '18:30', crowd: null, closures: false, tag: 'Rugby' },
  { id: 'biaf', name: 'Belfast International Arts Festival', venue: 'waterfront', date: ['2026-10-14', '2026-11-06'], time: null, crowd: null, closures: false, tag: 'Festival' },
  { id: 'giants-glasgow-1', name: 'Belfast Giants v Glasgow Clan', venue: 'o2', date: '2026-10-17', time: '19:00', crowd: null, closures: false, tag: 'Ice hockey' },
  { id: 'ni-open', name: 'BetVictor Northern Ireland Open (snooker)', venue: 'waterfront', date: ['2026-10-18', '2026-10-25'], time: null, crowd: null, closures: false, tag: 'Snooker' },
  { id: 'duranduran', name: 'Duran Duran', venue: 'o2', date: '2026-10-18', time: null, crowd: null, closures: false, tag: 'Concert' },
  { id: 'choirfest', name: 'City of Derry International Choir Festival', venue: 'derrycity', date: ['2026-10-22', '2026-10-25'], time: null, crowd: null, closures: false, tag: 'Festival' },
  { id: 'giants-glasgow-2', name: 'Belfast Giants v Glasgow Clan', venue: 'o2', date: '2026-10-25', time: '17:00', crowd: null, closures: false, tag: 'Ice hockey' },
  { id: 'westlife-1', name: 'Westlife — 25 Anniversary Tour', venue: 'o2', date: ['2026-10-27', '2026-10-29'], time: null, crowd: null, closures: false, tag: 'Concert' },
  { id: 'derry-halloween', name: 'Derry Halloween / Banks of the Foyle', venue: 'derrycity', date: ['2026-10-28', '2026-10-31'], time: null, crowd: 120000, closures: true, tag: 'Festival' },

  // ── November ──────────────────────────────────────────────────────────────
  { id: 'thescript', name: 'The Script', venue: 'o2', date: '2026-11-02', time: null, crowd: null, closures: false, tag: 'Concert' },
  { id: 'alisonmoyet', name: 'Alison Moyet', venue: 'waterfront', date: '2026-11-03', time: '19:00', crowd: null, closures: false, tag: 'Concert' },
  { id: 'westlife-2', name: 'Westlife — 25 Anniversary Tour', venue: 'o2', date: ['2026-11-05', '2026-11-06'], time: null, crowd: null, closures: false, tag: 'Concert' },
  { id: 'dexys', name: 'Dexys', venue: 'ulsterhall', date: '2026-11-05', time: '19:00', crowd: null, closures: false, tag: 'Concert' },
];

export const venueOf = (ev) => ev.venueOverride
  ? { ...VENUES[ev.venue], ...ev.venueOverride }
  : VENUES[ev.venue];

export const startOf = (ev) => Array.isArray(ev.date) ? ev.date[0] : ev.date;
export const endOf   = (ev) => Array.isArray(ev.date) ? ev.date[1] : ev.date;

/** Events still to come, soonest first. */
export const upcomingEvents = (todayISO) => {
  const today = todayISO || new Date().toISOString().slice(0, 10);
  return EVENTS.filter(e => endOf(e) >= today).sort((a, b) => startOf(a).localeCompare(startOf(b)));
};

export const formatWhen = (ev) => {
  const fmt = (d, opts) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-GB', opts);
  if (!Array.isArray(ev.date)) {
    return `${fmt(ev.date, { weekday: 'short', day: 'numeric', month: 'short' })}${ev.time ? ` · ${ev.time}` : ''}`;
  }
  const [a, b] = ev.date;
  const sameMonth = a.slice(0, 7) === b.slice(0, 7);
  return `${fmt(a, { day: 'numeric', month: sameMonth ? undefined : 'short' })}–${fmt(b, { day: 'numeric', month: 'short' })}`;
};

export default EVENTS;
