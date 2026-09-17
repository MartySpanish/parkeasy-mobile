// A parking timer is a promise with a fine attached to breaking it.
//
// The countdown that existed before this lived in a React state and a
// localStorage key, which made it accurate exactly while the tab was alive —
// and a phone discards that tab within minutes of the driver walking away. So
// the checks here are about the two halves that have to agree when nobody is
// looking: the bounds the client offers, and the sentence the notification
// says when it finally arrives.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { duePhrase, timerMessage } from '../../api/cron/parking-timers.js';
// ../../src/parked.js imports ./supabase, which only Vite resolves, so the
// pure half lives in parkedCore and the rest is asserted on its source text.
import {
  metresBetween, walkLabel, walkMinutes, directionsToCar, timeLeft,
  timerBoundReason, MIN_TIMER_MINS, MAX_TIMER_MINS,
} from '../../src/parkedCore.js';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const migration = read('../../supabase/migrations/20260917_parking_timers.sql');
const parked = read('../../src/parked.js');
const app = read('../../src/App.jsx');
const sweep = read('../../api/cron/parking-timers.js');
const vercel = JSON.parse(read('../../vercel.json'));

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };

console.log('\nparkingTimer — a reminder that arrives, and a car you can find again');

//------------------------------------------------------------- what it says
it('the notification says how long is left, in words a driver can act on', () => {
  const now = Date.parse('2026-09-17T14:00:00Z');
  assert.equal(duePhrase(new Date(now + 15 * 60000), now), 'in 15 minutes');
  assert.equal(duePhrase(new Date(now + 60 * 60000), now), 'in 1 hour');
  assert.equal(duePhrase(new Date(now + 120 * 60000), now), 'in 2 hours');
  // At the deadline, and past it, "now" — never "in -3 minutes", and never a
  // cheerful "in 0 minutes".
  assert.equal(duePhrase(new Date(now), now), 'now');
  assert.equal(duePhrase(new Date(now - 10 * 60000), now), 'now');
  assert.equal(duePhrase(new Date(now + 60000), now), 'now');
});

it('the notification never claims a fine, and never opens somewhere else', () => {
  const now = Date.parse('2026-09-17T14:00:00Z');
  const m = timerMessage({ session_id: 's1', due_at: new Date(now + 15 * 60000), label: 'Dublin Road' }, now);
  assert.match(m.title, /runs out in 15 minutes/);
  assert.match(m.body, /Dublin Road/);
  // We do not know the enforcement regime on that street, so we cannot say a
  // ticket is coming. Saying it would be the same class of error as telling a
  // driver a space is full when we only see ParkEasy users.
  assert.ok(m.url.startsWith('/'), `an absolute url in a notification: ${m.url}`);
  assert.equal(m.tag, 'parking-s1', 'one tag per session, so a replaced timer replaces the notification');
  assert.equal(m.requireInteraction, true, 'a deadline notification should not vanish unseen');

  // With no label the sentence still has to read.
  const bare = timerMessage({ session_id: 's2', due_at: new Date(now + 90 * 60000) }, now);
  assert.ok(!/null|undefined/.test(`${bare.title} ${bare.body}`), bare.body);
  assert.match(bare.title, /in 2 hours/);
  // And at the deadline the title changes rather than reading "runs out now".
  const up = timerMessage({ session_id: 's3', due_at: new Date(now) }, now);
  assert.equal(up.title, 'Your parking is up');

  // We do not know the enforcement regime on that street, so we cannot say a
  // ticket is coming. Saying it would be the same class of error as telling a
  // driver a space is full when we only see ParkEasy users. Every branch of
  // the sentence, not just the one with a label — the unlabelled body is the
  // one nobody looks at.
  for (const n of [m, bare, up]) {
    const text = `${n.title} ${n.body}`;
    assert.ok(!/fine|ticket|penalty|tow(ed|ing)?|clamp/i.test(text),
      `claims an outcome we cannot know: ${text}`);
  }
});

//--------------------------------------------------- the bounds, on both sides
it('the client and the database refuse the same timers', () => {
  // The sweep runs every five minutes, so a ten-minute floor is the shortest
  // promise that can be kept. Both halves have to agree or the UI offers
  // something the server then silently drops.
  // The database bounds, read out of the migration rather than restated, so
  // moving one without the other fails here.
  const floor = migration.match(/p_due_at < now\(\) \+ interval '(\d+) minutes'/);
  const ceil  = migration.match(/p_due_at > now\(\) \+ interval '(\d+) hours'/);
  assert.ok(floor, 'the database floor is gone — the sweep can be asked for a 1-minute timer');
  assert.ok(ceil, 'the database ceiling is gone — a driver can arm a reminder for next year');
  assert.equal(MIN_TIMER_MINS, Number(floor[1]), 'the client floor disagrees with the database');
  assert.equal(MAX_TIMER_MINS, Number(ceil[1]) * 60, 'the client ceiling disagrees with the database');

  // And the client refuses on the right side of each, rather than merely
  // holding the numbers.
  assert.equal(timerBoundReason(MIN_TIMER_MINS - 1), 'too-short');
  assert.equal(timerBoundReason(MIN_TIMER_MINS), null);
  assert.equal(timerBoundReason(MAX_TIMER_MINS), null);
  assert.equal(timerBoundReason(MAX_TIMER_MINS + 1), 'too-long');
  assert.equal(timerBoundReason(0), 'too-short', 'a missing duration must not pass as valid');
  assert.equal(timerBoundReason(undefined), 'too-short');
  assert.match(parked, /const bad = timerBoundReason\(mins\);\s*\n\s*if \(bad\) return \{ ok: false, reason: bad \}/,
    'setTimer no longer checks the bounds before writing the record');

  // And the chips on the sheet must all be inside those bounds.
  const chips = app.match(/const TIMER_CHOICES = \[([^\]]+)\]/);
  assert.ok(chips, 'the timer chips are gone');
  for (const m of chips[1].split(',').map(x => Number(x.trim()))) {
    assert.ok(m >= 10, `a ${m}-minute chip is shorter than the sweep interval`);
    assert.ok(m <= 24 * 60, `a ${m}-minute chip is past the database ceiling`);
  }
});

it('the sweep is scheduled often enough to keep the promise', () => {
  const cron = (vercel.crons || []).find(c => c.path === '/api/cron/parking-timers');
  assert.ok(cron, 'the parking-timer sweep is not scheduled at all');
  const m = cron.schedule.match(/^\*\/(\d+) \* \* \* \*$/);
  assert.ok(m, `the sweep runs on "${cron.schedule}" — a parking reminder needs minutes, not hours`);
  assert.ok(Number(m[1]) <= 10,
    `every ${m[1]} minutes is slower than the 10-minute floor the UI offers`);
});

//------------------------------------------------------- not sent twice, ever
it('the sweep stamps before it sends, and claims the row', () => {
  // Push-then-stamp duplicates a reminder when the stamp fails; stamp-then-push
  // loses one. A driver can recover from a missed reminder — the app still
  // shows the countdown — but two identical alerts five minutes apart is how a
  // notification channel gets switched off.
  const loop = sweep.slice(sweep.indexOf('for (const row of due)'));
  const stampAt = loop.indexOf("sent_at: new Date()");
  const pushAt = loop.indexOf('pushToSessions');
  assert.ok(stampAt > 0 && pushAt > 0, 'the sweep no longer both stamps and pushes');
  assert.ok(stampAt < pushAt, 'the sweep pushes before it stamps — a retry will send twice');
  // The stamp is conditional, so two overlapping sweeps cannot both claim it.
  assert.match(sweep, /sent_at=is\.null[^`]*`,\s*\n?\s*\{ method: 'PATCH'/,
    'the stamp is unconditional, so overlapping sweeps can both send');
  assert.match(sweep, /if \(!claimed\.length\) continue/,
    'the sweep sends even when another run already claimed the row');
  assert.match(sweep, /remind_at: `lte\./, 'the sweep no longer filters on remind_at');
  assert.match(sweep, /cancelled_at: 'is\.null'/, 'the sweep sends to drivers who have left');
});

//--------------------------------------------------------------- find my car
it('distance is measured, and never claimed more precisely than it is known', () => {
  // Belfast City Hall to the Botanic Gardens, about 1.2km.
  const d = metresBetween(54.5966, -5.9301, 54.5842, -5.9339);
  assert.ok(d > 1200 && d < 1500, `${Math.round(d)}m is not the real distance`);
  assert.equal(metresBetween(54.6, -5.93, 54.6, -5.93), 0);

  // A phone knows its own position to maybe 10m on a street with buildings
  // either side, so "137 m" claims a precision the number does not have.
  assert.equal(walkLabel(137), '140 m');
  assert.equal(walkLabel(4), '10 m', 'a sub-10m reading is rounded up, not to zero');
  assert.equal(walkLabel(1420), '1.4 km');
  assert.equal(walkLabel(NaN), '');
  assert.equal(walkMinutes(80), 1);
  assert.equal(walkMinutes(10), 1, 'a short walk is never "0 min"');
  assert.equal(walkMinutes(800), 10);
  assert.equal(walkMinutes(NaN), null);
});

it('the countdown counts down, and says nothing when no timer is set', () => {
  const now = 1_700_000_000_000;
  assert.equal(timeLeft({ dueAt: now + 90_000 }, now), 90_000);
  // Past the deadline it goes negative rather than clamping: the UI needs to
  // know it is overdue, and 0 looks the same as "just set".
  assert.ok(timeLeft({ dueAt: now - 60_000 }, now) < 0);
  assert.equal(timeLeft({ dueAt: null }, now), null);
  assert.equal(timeLeft(null, now), null, 'a driver who is not parked has no countdown');
});

it('the way back is coordinates and on foot, not the name of the place', () => {
  const url = directionsToCar({ name: 'Rear yard', lat: 54.6138, lng: -5.9428 });
  assert.match(url, /destination=54\.6138,-5\.9428/,
    'the route is built from the name — "Rear yard" is not an address');
  assert.match(url, /travelmode=walking/, 'the driver is on foot; they left the car at the other end');
  // A session recorded before this shipped has a name and no position. A
  // "find my car" button that cannot find the car is worse than none.
  assert.equal(directionsToCar({ name: 'Somewhere' }), null);
  assert.equal(directionsToCar(null), null);
  assert.equal(directionsToCar({ lat: 54.6, lng: null }), null);
  assert.match(app, /const url = directionsToCar\(session\);\s*\n\s*if \(!url\) return null;/,
    'the Find my car card renders without coordinates to offer');
});

//------------------------------------------------------------- the wiring
it('parking records where, not just what it was called', () => {
  assert.match(app, /startParked\(\{ spotId: spot\.id, name: spot\.name, rate, lat: spot\.lat, lng: spot\.lng \}\)/,
    'the session no longer records the spot position, so nothing can walk the driver back');
  assert.ok(!/ls\.set\('pe_session', sess\)/.test(app),
    'App.jsx writes the parked record behind src/parked.js again — two owners of one key');
});

it('ending the session cancels the reminder', () => {
  const end = app.slice(app.indexOf('const endSession ='), app.indexOf('const handleSpotAdded'));
  assert.match(end, /endParked\(\)/,
    'ending a session leaves the server reminder armed — the driver gets told '
    + 'about parking they already left');
});

it('a reminder that is only local says so', () => {
  // The difference between 'scheduled' and 'local-only' is whether anything
  // arrives when the phone is in a pocket. Reporting the second as success
  // would be the same lie as the booking error copy.
  assert.match(parked, /reason: 'local-only'/, 'the local-only outcome is gone');
  assert.match(parked, /reason: 'scheduled'/, 'the scheduled outcome is gone');
  assert.match(app, /Reminder set on this device only/, 'the UI no longer distinguishes the two');
  assert.match(app, /no alert if you close the app/, 'the UI implies an alert it cannot send');
});

console.log(`\n  ${passed} checks passed\n`);
