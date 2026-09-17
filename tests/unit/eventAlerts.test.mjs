// Matchday alerts, and the two things that make one worse than silence.
//
//   * The wrong hour. events.js stores CIVIL times — "19:45" means a quarter to
//     eight in Belfast — and its 2026 events span BST and GMT. Parsing them as
//     UTC is right in November and an hour out in August, which is the worst
//     kind of bug: it looks correct half the year and tells forty thousand
//     people to leave at the wrong time the other half.
//   * Arriving as the whistle goes. An alert that lands at kick-off reaches
//     somebody already parked or already circling, and costs the channel for
//     the one that would have mattered.
//
// Plus the reason any of this exists: a banner reaches whoever opens the app,
// and forty thousand people went to Boucher Road on 20 August without opening
// it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  londonOffsetMinutes, eventStartUtc, dayAlertAt, isDue, dueEvents, alertMessage,
  LEAD_MIN_MS, LEAD_MAX_MS,
} from '../../src/eventAlertsCore.js';
import { EVENTS, VENUES, venueOf } from '../../src/data/events.js';

const cut = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
  .replace(/^\s*--.*$/gm, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/^\s*\/\*[\s\S]*?\*\//gm, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const mig    = cut('../../supabase/migrations/20260919_event_alerts.sql');
const sweep  = cut('../../api/cron/event-alerts.js');
const client = cut('../../src/data/eventAlerts.js');
const screen = cut('../../src/components/events/EventsScreen.jsx');
const app    = cut('../../src/App.jsx');
const vercel = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };

console.log('\neventAlerts — the right hour, once, to somebody who asked');

//----------------------------------------------------------------- the clock
it('Belfast time is resolved per date, not assumed', () => {
  assert.equal(londonOffsetMinutes('2026-08-07'), 60, 'August is BST');
  assert.equal(londonOffsetMinutes('2026-11-20'), 0, 'November is GMT');
  assert.equal(londonOffsetMinutes('2026-01-15'), 0);
  assert.equal(londonOffsetMinutes('2026-07-01'), 60);
  // The clock changes on 29 March and 25 October 2026. THE CHANGE DAYS
  // THEMSELVES are the only dates where the answer depends on what time of day
  // the offset is read at: at 00:30 UTC on 25 October London is still BST, at
  // midday it is GMT. Reading at midnight instead of midday is wrong on
  // exactly these two days a year and correct on the other 363, so without
  // them the check passes on nothing.
  assert.equal(londonOffsetMinutes('2026-10-25'), 0, 'the day the clocks go back is GMT');
  assert.equal(londonOffsetMinutes('2026-03-29'), 60, 'the day they go forward is BST');
  assert.equal(londonOffsetMinutes('2026-10-24'), 60, 'the Saturday before the change');
  assert.equal(londonOffsetMinutes('2026-10-26'), 0, 'the Monday after it');
  assert.equal(londonOffsetMinutes('nonsense'), 0, 'an unparseable date is not an exception');
  assert.equal(londonOffsetMinutes(null), 0);
});

it('a civil kick-off time becomes the right instant in both halves of the year', () => {
  // 19:45 in Belfast in August is 18:45 UTC. Parsing the stored string as UTC
  // would make it 19:45 UTC — an hour late, every summer fixture.
  assert.equal(new Date(eventStartUtc('2026-08-07', '19:45')).toISOString(),
    '2026-08-07T18:45:00.000Z');
  // And in November it really is 19:45 UTC, which is why the naive version
  // looks correct if you only ever test it in winter.
  assert.equal(new Date(eventStartUtc('2026-11-20', '19:45')).toISOString(),
    '2026-11-20T19:45:00.000Z');
  assert.equal(new Date(eventStartUtc('2026-08-30', '16:00')).toISOString(),
    '2026-08-30T15:00:00.000Z');
});

it('no published start time produces no invented one', () => {
  // ON THE `if (!dayISO || !time)` GUARD IN eventStartUtc. It is an equivalent
  // mutant — removing it changes no outcome, because Date.parse rejects the
  // assembled string either way — and it is kept anyway, unlike the two shape
  // regexes that went for exactly that reason. The difference: those claimed
  // to validate a FORMAT and validated nothing, while this one states the
  // contract (both arguments are required) and stops the function depending on
  // how JavaScript happens to stringify null. Not every equivalent mutant is a
  // finding; two of the three on this function were.

  // events.js leaves `time` null wherever sources disagreed, on the stated
  // grounds that a wrong time is worse than none: it tells somebody to arrive
  // when the car park is already full.
  assert.equal(eventStartUtc('2026-08-07', null), null);
  assert.equal(eventStartUtc('2026-08-07', ''), null);
  assert.equal(eventStartUtc('2026-08-07', '7pm'), null);
  assert.equal(eventStartUtc('2026-08-07', '25:00'), null, 'a 25th hour is not a time');
  assert.equal(eventStartUtc('2026-08-07', '19:75'), null, 'a 75th minute is not a time');
  // "24:00" is valid ISO 8601 and means midnight at the START of the next day,
  // so Date.parse accepts it and the alert lands on the wrong date. It is the
  // only malformed time that gets that far.
  assert.equal(eventStartUtc('2026-08-07', '24:00'), null,
    'a 24:00 start silently becomes the following day');
  assert.equal(eventStartUtc(null, '19:45'), null);
  assert.equal(eventStartUtc('7 Aug 2026', '19:45'), null, 'only ISO dates are accepted');
  // Instead it gets a civil-morning alert, which is the honest version for a
  // festival closing roads all day.
  assert.equal(new Date(dayAlertAt('2026-08-07')).toISOString(), '2026-08-07T08:00:00.000Z');
});

//----------------------------------------------------------------- the window
it('the alert lands hours before, never at kick-off', () => {
  const start = eventStartUtc('2026-08-07', '19:45');
  assert.equal(isDue(start, start - 3 * 3600000), true, 'three hours before is the decision point');
  assert.equal(isDue(start, start - 3600000), false, 'an hour before is too late to change plan');
  assert.equal(isDue(start, start), false, 'an alert at kick-off is worse than none');
  assert.equal(isDue(start, start + 3600000), false, 'and one after it is worse again');
  assert.equal(isDue(start, start - 30 * 3600000), false, 'a day ahead is not news yet');
  // Nothing sane comes of a missing start, and none of these needs a guard in
  // front of the comparison — the difference fails one side or the other.
  assert.equal(isDue(null, Date.now()), false);
  assert.equal(isDue(NaN, Date.now()), false);
  assert.equal(isDue(undefined, Date.now()), false);
  assert.equal(isDue(Infinity, Date.now()), false);

  // THE WINDOW HAS TO BE WIDER THAN THE SWEEP INTERVAL, or an event whose lead
  // time falls between two runs is never alerted on at all.
  const cron = (vercel.crons || []).find(c => c.path === '/api/cron/event-alerts');
  assert.ok(cron, 'the event-alert sweep is not scheduled');
  assert.match(cron.schedule, /^0 \* \* \* \*$|^\*\/\d+ \* \* \* \*$/,
    `the sweep runs on "${cron.schedule}"`);
  const everyMs = cron.schedule.startsWith('0 ')
    ? 3600000
    : Number(cron.schedule.match(/^\*\/(\d+)/)[1]) * 60000;
  assert.ok(LEAD_MAX_MS - LEAD_MIN_MS >= everyMs,
    `the window is ${(LEAD_MAX_MS - LEAD_MIN_MS) / 3600000}h and the sweep runs every `
    + `${everyMs / 3600000}h — an event can fall between two runs and never be alerted`);
});

it('a multi-day festival is one piece of news, not seven', () => {
  const fleadh = { id: 'f', name: 'Fleadh', venue: 'o2', date: ['2026-08-02', '2026-08-09'], time: null };
  // Road closures for a week-long festival are one thing to say. Seven pushes
  // about it is how somebody turns notifications off.
  const at = dayAlertAt('2026-08-02');
  assert.deepEqual(dueEvents([fleadh], at - 3 * 3600000).map(d => d.ev.id), ['f']);
  // Its later days produce nothing, because the window is judged from day one.
  for (const day of ['2026-08-05', '2026-08-09']) {
    assert.equal(dueEvents([fleadh], dayAlertAt(day) - 3 * 3600000).length, 0,
      `${day} produced a second alert for the same festival`);
  }
});

it('the sweep picks out only what is due, soonest first', () => {
  const now = Date.parse('2026-08-07T15:45:00Z');           // 16:45 Belfast
  const rows = [
    { id: 'late',  name: 'Late',  venue: 'o2',       date: '2026-08-07', time: '19:45' }, // 3h
    { id: 'later', name: 'Later', venue: 'windsor',  date: '2026-08-07', time: '18:45' }, // 2h
    { id: 'gone',  name: 'Gone',  venue: 'solitude', date: '2026-08-07', time: '16:00' }, // past
    { id: 'tmrw',  name: 'Tmrw',  venue: 'o2',       date: '2026-08-08', time: '19:45' }, // a day
  ];
  assert.deepEqual(dueEvents(rows, now).map(r => r.ev.id), ['later', 'late'],
    'the wrong events are due, or in the wrong order');
  assert.deepEqual(dueEvents([], now), []);
  assert.deepEqual(dueEvents(null, now), []);
});

//---------------------------------------------------------------- the sentence
it('the notification says what is true and claims nothing about spaces', () => {
  const at = eventStartUtc('2026-08-07', '19:45');
  const m = alertMessage(
    { id: 'clift-crus', name: 'Cliftonville v Crusaders', time: '19:45', closures: false },
    { name: 'Solitude', area: 'Cliftonville' }, at);
  assert.match(m.title, /Cliftonville v Crusaders at 19:45/,
    'the time is not in Belfast terms');
  assert.match(m.body, /Solitude, Cliftonville/);
  // We do not know the occupancy of a single street near any of these grounds.
  // Claiming we do is the same error as the booking copy that told a driver to
  // try a different card when the host had no payout account.
  const text = `${m.title} ${m.body}`;
  assert.ok(!/filling up|going fast|arrive early|spaces left|nearly full|hurry/i.test(text), text);
  assert.ok(m.url.startsWith('/'), `an absolute url in a notification: ${m.url}`);
  assert.equal(m.tag, 'event-clift-crus', 'one tag per event, so a second sweep replaces it');
  // Not a deadline with a cost attached, unlike a parking timer. A buzz for
  // "there is a concert in three hours" is a reason to switch alerts off.
  assert.equal(m.requireInteraction, false);
});

it('a road closure is said, because it changes the route and not just the parking', () => {
  const at = eventStartUtc('2026-08-02', '12:00');
  const closed = alertMessage({ id: 'f', name: 'Fleadh', time: '12:00', closures: true },
    { name: 'Belfast city centre' }, at);
  assert.match(closed.body, /roads closed nearby/);
  const open = alertMessage({ id: 'g', name: 'Gig', time: '12:00', closures: false },
    { name: 'The O2 Belfast' }, at);
  assert.ok(!/roads closed/.test(open.body), open.body);
  // BOTH BRANCHES. The sentence is built one way for a venue with an area and
  // another for one without, and the first version of this check only ever
  // exercised the second — so the closure warning could have been dropped from
  // every venue that has an area, which is nearly all of them.
  const withArea = alertMessage({ id: 'h', name: 'Match', time: '19:45', closures: true },
    { name: 'Windsor Park', area: 'Donegall Avenue' }, at);
  assert.match(withArea.body, /Donegall Avenue — roads closed nearby/, withArea.body);
  const openWithArea = alertMessage({ id: 'i', name: 'Match', time: '19:45', closures: false },
    { name: 'Windsor Park', area: 'Donegall Avenue' }, at);
  assert.ok(!/roads closed/.test(openWithArea.body), openWithArea.body);
});

it('an event with no start time does not have one read out', () => {
  const at = dayAlertAt('2026-08-30');
  const m = alertMessage({ id: 'mela', name: 'Belfast Mela Day', time: null, closures: false },
    { name: 'Botanic Gardens', area: 'Botanic' }, at);
  assert.match(m.title, /Belfast Mela Day today$/, m.title);
  assert.ok(!/\d\d:\d\d/.test(m.title), `a time appeared from nowhere: ${m.title}`);
  assert.ok(!/null|undefined|NaN/.test(`${m.title} ${m.body}`), m.body);
  // And a venue with no area still reads.
  const bare = alertMessage({ id: 'x', name: 'Thing', time: null }, { name: 'Somewhere' }, at);
  assert.ok(!/,\s*\./.test(bare.body) && !/undefined/.test(bare.body), bare.body);
  const none = alertMessage({ id: 'y', name: 'Thing' }, null, at);
  assert.match(none.body, /Belfast/, 'with no venue at all the sentence still names a place');
});

//------------------------------------------------- the real calendar, end to end
it('every event in the real calendar produces a sane alert', () => {
  // The guard this suite is really for: events.js is hand-built data and a
  // malformed row must not take the sweep down or push a sentence with "null"
  // in it to every follower of a ground.
  for (const ev of EVENTS) {
    const day = Array.isArray(ev.date) ? ev.date[0] : ev.date;
    const at = ev.time ? eventStartUtc(day, ev.time) : dayAlertAt(day);
    assert.ok(Number.isFinite(at), `${ev.id} produces no instant at all`);
    const m = alertMessage(ev, venueOf(ev), at);
    assert.ok(m.title && m.body && m.url, `${ev.id} produces an empty notification`);
    assert.ok(!/null|undefined|NaN|Invalid/.test(`${m.title} ${m.body} ${m.url}`),
      `${ev.id}: ${m.title} / ${m.body}`);
    assert.ok(m.url.startsWith('/'), `${ev.id} has an absolute url`);
    // And the instant lands on the right day in Belfast terms, which is the
    // check that catches an off-by-one-hour at either end of the day.
    const local = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London' }).format(new Date(at));
    assert.equal(local, day, `${ev.id} is alerted on the wrong day (${local} vs ${day})`);
  }
});

//--------------------------------------------------------- claimed, then pushed
it('the sweep claims before it pushes, and pushes only what it claimed', () => {
  // The sweep runs hourly against a two-hour window, so without the claim every
  // follower is told twice about every fixture.
  // Read from inside the loop. `pushToSessions` also appears in the import at
  // the top of the file, which is above everything and would make any ordering
  // look correct.
  const loop = sweep.slice(sweep.indexOf('for (const { ev, at } of due)'));
  const claimAt = loop.indexOf('rpc/claim_event_alerts');
  const pushAt = loop.indexOf('pushToSessions(');
  assert.ok(claimAt > 0 && pushAt > 0, 'the sweep no longer both claims and pushes');
  assert.ok(claimAt < pushAt, 'the sweep pushes before it claims — a retry sends twice');
  assert.match(sweep, /if \(!sessions\.length\) continue;/,
    'the sweep pushes to an empty list, or to people it did not claim');
  assert.match(sweep, /pushToSessions\(sessions,/,
    'the sweep pushes to somebody other than the sessions it claimed');
  // The claim is the thing that makes it once-only, and it is service-role.
  assert.match(mig, /on conflict \(session_id, event_id\) do nothing/,
    'the claim no longer dedupes');
  assert.match(mig, /grant execute on function public\.claim_event_alerts\(text, text, integer\) to service_role;/,
    'claiming is reachable from a browser');
  assert.ok(!/grant execute on function public\.claim_event_alerts[^;]*to (anon|authenticated)/.test(mig),
    'a driver can claim alerts and silence a whole venue');
});

it('already-told followers are excluded before the limit, not after', () => {
  // Otherwise the limit picks the same first N rows every run, the insert
  // conflicts on all of them, and a venue with more followers than the limit
  // never gets past the first N — the backlog the limit exists to spread out is
  // the one thing it would prevent.
  const fn = mig.slice(mig.indexOf('function public.claim_event_alerts'),
                       mig.indexOf('grant execute on function public.claim_event_alerts'));
  const notExists = fn.indexOf('not exists');
  const limit = fn.indexOf('limit greatest');
  assert.ok(notExists > 0, 'the claim no longer excludes followers already told');
  assert.ok(notExists < limit, 'the exclusion happens after the limit, so a big venue stalls');
});

it('an event at a one-off location is skipped rather than half-sent', () => {
  // venueOverride carries a name and coordinates but no venue key — "Belfast
  // city centre" for the Fleadh — so there is nobody following it.
  assert.match(sweep, /if \(!key \|\| !VENUES\[key\]\) continue;/,
    'an event with no followable venue key is claimed against anyway');
  const override = EVENTS.find(e => e.venueOverride);
  if (override) {
    assert.ok(override.venue, 'the override event has no base venue either — check the skip');
  }
});

//-------------------------------------------------------------- who gets told
it('following a venue is what subscribes somebody, not their location', () => {
  // The alternative design pushes to everybody near the ground and means
  // storing where drivers are.
  assert.ok(!/lat|lng|latitude|coords|geolocation/i.test(mig),
    'the alert tables store a position');
  assert.match(mig, /venue      text        not null/, 'follows are no longer keyed on a venue');
  // Per function. A bare search was satisfied by fetchEventAlerts' own call
  // while setEventAlert sent none.
  for (const fn of ['setEventAlert', 'fetchEventAlerts']) {
    const at = client.indexOf(`export async function ${fn}`);
    assert.ok(at > 0, `${fn} is gone`);
    const body = client.slice(at, client.indexOf('});', at));
    assert.match(body, /p_session_id: sessionId\(\)/,
      `${fn} does not say which browser it is`);
  }
  for (const arg of ['p_session_id', 'p_venue', 'p_on']) {
    assert.ok(mig.includes(arg), `${arg} is not a parameter in the migration`);
  }
});

it('permission is asked before the follow is recorded', () => {
  // Recording a follow and then being refused the notification permission
  // leaves somebody certain they will be told about a fixture they will hear
  // nothing about.
  const fn = screen.slice(screen.indexOf('const FollowVenue'), screen.indexOf('const FollowVenue') + 2200);
  assert.ok(fn.length > 400, 'the follow button is gone');
  assert.ok(fn.indexOf('enablePush') < fn.indexOf('setEventAlert'),
    'the follow is recorded before permission is asked');
  assert.match(fn, /if \(want && !\(await isPushEnabled\(\)\)\)/,
    'permission is asked every time, or never');
  assert.match(fn, /if \(!r\.ok\) \{[\s\S]{0,300}?onChange\?\.\(venueKey, false/,
    'a refused permission still leaves the button looking followed');
  // A denied permission says where to undo it; a dismissed prompt does not
  // scold anybody.
  assert.match(fn, /Alerts are blocked for ParkEasy in your browser settings/);
  assert.match(fn, /No bother/);
  // A one-off location has nobody to follow.
  assert.match(fn, /if \(!venueKey\) return null;/, 'a venue with no key renders a dead button');
});

it('the button shows what the server said, not what the tap assumed', () => {
  assert.match(client, /return data === true;/,
    'the client reports success without reading the answer');
  assert.match(screen, /const now = await setEventAlert\(venueKey, want\);/,
    'the follow state is no longer taken from the server');
  assert.match(screen, /onChange\?\.\(venueKey, now,/, 'the button is set from the tap instead');
  // Read once for the whole screen, not once per event opened.
  assert.match(screen, /useEffect\(\(\) => \{ let live = true; fetchEventAlerts\(\)/,
    'the follow list is fetched per event, or not at all');
});

//---------------------------------------------------------------- the toast bus
it('a message meant for the driver does not email the founder', () => {
  // notify() in src/notify.js POSTs to /api/notify, which emails
  // parkeasyuk@gmail.com. It reads exactly like a toast and is not one, and
  // four features called it that way — so every one of those sentences went to
  // the founder's inbox and none of them reached the driver.
  const bare = [...app.matchAll(/(?<![A-Za-z])notify\(\s*(['"`])/g)];
  for (const m of bare) {
    const at = m.index;
    const snippet = app.slice(at, at + 90);
    // A legitimate call names a template type and passes data.
    assert.match(snippet, /notify\((['"`])[a-z_]+\1\s*,/,
      `a sentence is being emailed instead of shown: ${snippet.split('\n')[0]}`);
  }
  assert.ok(!/notify\(message/.test(screen), 'the events screen emails its toast');
  assert.match(screen, /toast\(message, on \? 'ok' : 'warn'\)/, 'the follow says nothing at all');
  // And the bus is actually wired to the banner that was always there.
  assert.match(app, /const off = onToast\(\(\{ msg, tone \}\) => \{[\s\S]{0,200}?setFlash\(\{ tone, msg \}\)/,
    'the toast bus is not connected to the flash banner');
  assert.match(app, /timer = setTimeout\(\(\) => setFlash\(null\), \d+\);/,
    'a toast never clears itself');
  assert.match(app, /return \(\) => \{ off\(\); clearTimeout\(timer\); \};/,
    'a remount leaves a dead setState on the bus');
});

console.log(`\n  ${passed} checks passed\n`);
