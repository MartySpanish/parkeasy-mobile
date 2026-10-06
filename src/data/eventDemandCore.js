// What to say to somebody who lives beside a stadium.
//
// The events screen already asks for supply at the right moment — it shows
// "Nobody is renting out a space here yet" beside a venue full of people. What
// it did not do was say how many people, or that it happens again, and those
// are the two facts that actually persuade somebody to open their gate.
//
// From the founder's own outreach note for Windsor Park:
//
//   "17,000 people are walking past your gate tonight and there's nowhere for
//    them to park... There's another international a week today, so it's two
//    nights, not one."
//
// A crowd number and a second date. Both are already in EVENTS; nothing here
// invents a figure. And one more thing that note flags, learned the hard way at
// Davitt Park: a 19:45 kick-off does not end at 19:45. A host who agrees to
// open the gate and closes it at nine has stranded the cars inside. So the ask
// states the hour the space is actually needed until, before anybody says yes.
//
// Pure and dependency-free so Node can drive it — the same reason parkedCore
// and pointsCore exist.

/** Minutes a crowd takes to clear after the event itself finishes. */
export const CLEAR_MINS = 45;

/** How long an event runs, when nobody has said. */
const DEFAULT_RUN_MINS = { Football: 120, Music: 180, Comedy: 150, Festival: 240 };
export const runMinutes = (ev) =>
  (ev && DEFAULT_RUN_MINS[ev.tag]) || 150;

const pad = (n) => String(n).padStart(2, '0');

/**
 * The clock time a host's space is needed until: start + the event's run +
 * time for the car park to clear, rounded up to the next quarter hour.
 *
 * Returns null for an event with no start time — a festival running all day
 * cannot have an end inferred, and a made-up one is worse than none.
 */
export const openUntil = (ev) => {
  const t = ev && typeof ev.time === 'string' ? ev.time.match(/^(\d{1,2}):(\d{2})$/) : null;
  if (!t) return null;
  const h = Number(t[1]), m = Number(t[2]);
  if (!(h >= 0 && h < 24) || !(m >= 0 && m < 60)) return null;

  let mins = h * 60 + m + runMinutes(ev) + CLEAR_MINS;
  mins = Math.ceil(mins / 15) * 15;
  // Past midnight stays on a 24-hour clock rather than wrapping to 00:30 with
  // no hint it is the next day — a host reading "00:30" needs to know that.
  const nextDay = mins >= 24 * 60;
  const hh = Math.floor((mins % (24 * 60)) / 60), mm = mins % 60;
  return { time: `${pad(hh)}:${pad(mm)}`, nextDay };
};

/**
 * The next event at the same venue, so the ask can be "two nights, not one".
 *
 * `after` is the event being looked at, not today: a driver browsing next
 * week's fixture should be told about the one after THAT, not one that has
 * already happened.
 */
export const nextAtVenue = (ev, all, startOf) => {
  if (!ev || !Array.isArray(all)) return null;
  const from = startOf(ev);
  return all
    .filter(e => e.venue === ev.venue && e.id !== ev.id && startOf(e) > from)
    .sort((a, b) => startOf(a).localeCompare(startOf(b)))[0] || null;
};

/** 17000 → "17,000". Plain, and never rounded up into a claim. */
export const crowdWord = (n) =>
  Number.isFinite(n) && n > 0 ? Math.floor(n).toLocaleString('en-GB') : null;

/**
 * The whole ask, assembled — or null when there is nothing true to say.
 *
 * Every clause is dropped independently when its fact is missing, so a venue
 * with no crowd figure and no repeat fixture still gets a sentence, just a
 * shorter and equally true one.
 */
export const hostPitch = (ev, all, startOf, formatWhen) => {
  if (!ev) return null;
  const crowd = crowdWord(ev.crowd);
  const next = nextAtVenue(ev, all, startOf);
  const until = openUntil(ev);
  return {
    crowd,
    // "and 18,434 again on Mon 5 Oct" — the second payday.
    repeat: next ? { name: next.name, when: formatWhen ? formatWhen(next) : startOf(next) } : null,
    until,
  };
};
