// When to tell somebody an event is on, and what the sentence says.
//
// WHAT A BANNER CANNOT DO. The home screen already shows "Tonight: Anastacia ·
// Waterfront Hall · 19:00 — park before you set off". It only helps somebody
// who opens the app, and the person driving to Windsor Park at 18:50 did not
// open it. Forty thousand people went to Boucher Road on 20 August and the app
// said nothing to any of them. Push exists now (docs/push.md); this is the half
// that decides who gets told and when.
//
// PURE, AND SEPARATE, for the usual reason — api/cron/event-alerts.js needs it
// and so does a Node test, and the time arithmetic below is the part most
// likely to be quietly wrong.
//
// THE TIME ZONE IS THE WHOLE PROBLEM. src/data/events.js stores civil times:
// "19:45" means a quarter to eight in Belfast. Between them the 2026 events in
// that file span BST and GMT, so `new Date('2026-08-07T19:45:00Z')` is an hour
// out for most of them and correct for the rest — which is the worst kind of
// bug, because it looks right in November and tells forty thousand people the
// wrong hour in August. The offset is resolved per event, from the platform's
// own tz database, at the actual instant.

/**
 * Europe/London's UTC offset in minutes, on a given date.
 *
 * Read from Intl rather than computed from the last-Sunday-in-March rule. That
 * rule is right today and is not ours to maintain: the EU has voted to abolish
 * the clock change twice and the platform's tz database will know before this
 * file does.
 *
 * @param dayISO 'YYYY-MM-DD'
 * @returns minutes ahead of UTC (60 in summer, 0 in winter), or 0 if unknown
 */
export const londonOffsetMinutes = (dayISO) => {
  try {
    // Midday, deliberately: it is never within an hour of a clock change, so
    // the offset returned is the one that applies to the whole civil day.
    const at = new Date(`${dayISO}T12:00:00Z`);
    if (Number.isNaN(at.getTime())) return 0;
    const name = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/London', timeZoneName: 'shortOffset',
    }).formatToParts(at).find(p => p.type === 'timeZoneName')?.value || '';
    // 'GMT' in winter, 'GMT+1' in summer.
    const m = name.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/);
    if (!m) return 0;
    return Number(m[1]) * 60 + (Number(m[2]) || 0) * Math.sign(Number(m[1]) || 1);
  } catch { return 0; }
};

/**
 * The instant an event starts, in ms since the epoch — or null.
 *
 * null when the event has no published start time, and that is not a gap to
 * paper over. events.js leaves `time` null wherever sources disagreed, on the
 * stated grounds that a wrong time is worse than no time: it tells somebody to
 * arrive when the car park is already full. So an event with no time gets a
 * different alert (see `dayAlertAt`) rather than an invented one.
 */
export const eventStartUtc = (dayISO, time) => {
  if (!dayISO || !time) return null;
  // ONE GUARD THAT MATTERS, and it is not the obvious one.
  //
  // Date.parse on the assembled string rejects everything malformed by itself
  // — '7pm', '19:75', '9:45', '2026-8-7' are all NaN — so the shape checks
  // this function started with (a regex on the date and another on the time)
  // changed no outcome at all, and the mutation test said so. They are gone.
  //
  // "24:00" is the exception, and the reason a check survives here: it is
  // valid ISO 8601 meaning midnight at the START of the next day, so
  // Date.parse accepts it happily and the alert lands on the wrong date.
  const [h, min] = String(time).split(':').map(Number);
  if (h > 23 || min > 59) return null;
  const base = Date.parse(`${dayISO}T${time}:00Z`);
  if (Number.isNaN(base)) return null;
  // Civil time minus the offset gives the instant. 19:45 BST is 18:45 UTC.
  return base - londonOffsetMinutes(dayISO) * 60000;
};

/** 09:00 Belfast time on the day, for an event with no published start. */
export const dayAlertAt = (dayISO) => eventStartUtc(dayISO, '09:00');

// HOW FAR AHEAD. Three hours before kick-off is the decision point: long
// enough to choose a park-and-ride instead of circling Donegall Avenue, close
// enough that the message is about tonight and not about the weekend. The sweep
// runs hourly, so the window has to be at least an hour wide or an event whose
// start falls between two runs is never alerted at all.
export const LEAD_MIN_MS = 2 * 3600000;
export const LEAD_MAX_MS = 4 * 3600000;

/**
 * Is this event due an alert right now?
 *
 * Deliberately NOT "has it started" — an alert that arrives as the whistle goes
 * is worse than none, because the driver is already parked or already circling.
 * Past events fall out of the window on their own.
 */
export const isDue = (startMs, now) => {
  // No guard on startMs, deliberately. null, undefined and NaN all produce a
  // difference that fails one side of the comparison or the other, so a
  // Number.isFinite() check in front changes no outcome — it read as careful
  // and the mutation test showed it was decoration.
  const ahead = startMs - now;
  return ahead >= LEAD_MIN_MS && ahead <= LEAD_MAX_MS;
};

/**
 * The events that should be alerted on this sweep, with the instant each was
 * judged against.
 *
 * @param events rows shaped like src/data/events.js
 * @param now    ms
 */
export const dueEvents = (events, now) => (events || [])
  .map(ev => {
    const day = Array.isArray(ev.date) ? ev.date[0] : ev.date;
    // A multi-day festival alerts once, on its first day. Road closures for a
    // week-long Fleadh are one piece of news, and seven pushes about it is how
    // somebody turns notifications off.
    const at = ev.time ? eventStartUtc(day, ev.time) : dayAlertAt(day);
    return { ev, at };
  })
  .filter(({ at }) => isDue(at, now))
  .sort((a, b) => a.at - b.at);

/** "in 3 hours", "at 19:45" — how the sentence refers to the time. */
const clock = (ms) => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date(ms));

/**
 * The notification.
 *
 * WHAT IT WILL NOT SAY. Not "spaces are filling up" and not "arrive early to
 * get a space" — we do not know the occupancy of a single street near Windsor
 * Park, and claiming we do is the same error as the booking copy that told a
 * driver to try a different card when the host had no payout account. It says
 * what is true: this is on, at this time, here is the parking page.
 */
export const alertMessage = (ev, venue, at) => {
  const where = venue?.name || 'Belfast';
  const when = ev.time ? `at ${clock(at)}` : 'today';
  return {
    title: `${ev.name} ${when}`,
    // The area, because "Affidea Stadium" means nothing to somebody who knows
    // it as Ravenhill, and the closures flag, because a road closure changes
    // the route and not just the parking.
    body: venue?.area
      ? `${where}, ${venue.area}${ev.closures ? ' — roads closed nearby' : ''}. Where to park →`
      : `${where}${ev.closures ? ' — roads closed nearby' : ''}. Where to park →`,
    url: `/?event=${encodeURIComponent(ev.id)}`,
    // One tag per event, so a second sweep replaces rather than stacks.
    tag: `event-${ev.id}`,
    // Not a deadline with a cost attached, unlike a parking timer. A buzz for
    // "there's a concert on in three hours" is a reason to switch alerts off.
    requireInteraction: false,
  };
};
