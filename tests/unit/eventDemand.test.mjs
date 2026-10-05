// The ask made to somebody who lives beside a stadium.
//
// The events screen already asked for supply at the right moment. What it said
// was "Drivers coming to this event are looking for one" — the same sentence
// beside a 200-seat comedy night and an eighteen-thousand-seat international,
// and it persuades nobody to open a gate.
//
// The founder's own doorstep pitch for Windsor Park is the model:
//
//   "17,000 people are walking past your gate tonight and there's nowhere for
//    them to park... There's another international a week today, so it's two
//    nights, not one."
//
// A crowd number and a second date, both already on the event. And the thing
// that note flags from Davitt Park: confirm the site can stay open to ~22:30,
// because a 19:45 kick-off does not end at 19:45. That last one is not
// persuasion — it is the difference between a host who says yes and a host who
// locks somebody's car in at nine o'clock.
//
// These are claims made to a stranger about their own property, so they get
// held to the same bar as a restriction on a bay.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const {
  hostPitch, openUntil, nextAtVenue, crowdWord, runMinutes, CLEAR_MINS,
} = await import('../../src/data/eventDemandCore.js');
const { EVENTS, startOf, formatWhen } = await import('../../src/data/events.js');

const screen = readFileSync(
  new URL('../../src/components/events/EventsScreen.jsx', import.meta.url), 'utf8');

const windsor = EVENTS.find(e => e.id === 'ni-hungary');

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };

console.log('\neventDemand — the number and the second date are the argument');

it('the real Windsor fixture produces the founder\'s own pitch', () => {
  assert.ok(windsor, 'the Windsor fixture is gone from EVENTS');
  const p = hostPitch(windsor, EVENTS, startOf, formatWhen);
  assert.equal(p.crowd, '18,434', 'the crowd figure is wrong or unformatted');
  assert.ok(p.repeat, 'the second fixture at the same venue is not found');
  assert.match(p.repeat.name, /Georgia/, 'the repeat is not the next Windsor fixture');
  // The Davitt Park number, arrived at rather than typed in: 19:45 + 120 for
  // the football + 45 to clear = 22:30.
  assert.equal(p.until.time, '22:30',
    'the hour a host would need to stay open no longer matches the real one');
  assert.equal(p.until.nextDay, false);
});

it('the end time is derived from the event, not a constant', () => {
  // A constant would pass the Windsor check above and be wrong everywhere else.
  const football = openUntil({ time: '19:45', tag: 'Football' });
  const music = openUntil({ time: '19:45', tag: 'Music' });
  assert.notEqual(football.time, music.time,
    'a three-hour gig and a two-hour match give the same closing time');
  assert.ok(runMinutes({ tag: 'Music' }) > runMinutes({ tag: 'Football' }),
    'a gig is not treated as longer than a match');
  assert.ok(CLEAR_MINS > 0, 'no time is allowed for the car park to clear');
  // Rounded UP to the quarter hour: a host told 22:28 hears "about half ten"
  // anyway, and rounding down would understate what they are agreeing to.
  assert.match(football.time, /:(00|15|30|45)$/, 'the time is not on a quarter hour');
  // Checked on a time that does NOT already land on a quarter, or floor and
  // ceil agree and the assertion proves nothing. 19:50 + 120 + 45 = 22:35,
  // which must round UP to 22:45 and never down to 22:30.
  assert.equal(openUntil({ time: '19:50', tag: 'Football' }).time, '22:45',
    'the closing time rounds down, telling a host they can shut before the last car is out');
});

it('a late finish says it is the next morning', () => {
  const late = openUntil({ time: '23:00', tag: 'Music' });
  assert.ok(late, 'a late event gets no closing time at all');
  assert.equal(late.nextDay, true,
    '02:45 is shown with no hint it is tomorrow — a host reads that as this evening');
  const early = openUntil({ time: '15:00', tag: 'Football' });
  assert.equal(early.nextDay, false, 'an afternoon match is claimed to run past midnight');
});

it('an event with no start time claims no end time', () => {
  // A festival running across two days has no inferable end, and a made-up one
  // is worse than none — it is the field a host would plan their evening on.
  assert.equal(openUntil({ time: null, tag: 'Festival' }), null);
  assert.equal(openUntil({ time: 'tea time', tag: 'Music' }), null);
  assert.equal(openUntil({ time: '25:00', tag: 'Music' }), null, 'an impossible hour is accepted');
  assert.equal(openUntil({ time: '19:75', tag: 'Music' }), null, 'an impossible minute is accepted');
});

it('the repeat is the next one AFTER this event, not the next one from today', () => {
  // Somebody reading next month's fixture must not be told about one that has
  // already been played.
  const list = [
    { id: 'a', venue: 'v', date: '2026-01-01' },
    { id: 'b', venue: 'v', date: '2026-02-01' },
    // Same venue, SAME DAY as b — a double-header, not a second night. It must
    // not be offered as the repeat: the whole pitch is "two nights, not one".
    { id: 'b2', venue: 'v', date: '2026-02-01' },
    { id: 'c', venue: 'v', date: '2026-03-01' },
    { id: 'x', venue: 'other', date: '2026-01-15' },
  ];
  const s = (e) => e.date;
  const at = (id) => list.find(e => e.id === id);   // by id: indices shift when a case is added
  assert.equal(nextAtVenue(at('b'), list, s).id, 'c',
    'the repeat looks backwards, or counts a same-day event as a second night');
  assert.equal(nextAtVenue(at('c'), list, s), null, 'a last fixture invents a repeat');
  // And never another venue's event.
  assert.equal(nextAtVenue(at('a'), list, s).id, 'b', 'an event at a different venue is offered as the repeat');
});

it('every clause drops on its own when its fact is missing', () => {
  const bare = hostPitch({ id: 'z', venue: 'nowhere', date: '2026-01-01' }, [], (e) => e.date, null);
  assert.equal(bare.crowd, null, 'a missing crowd becomes a number');
  assert.equal(bare.repeat, null, 'a one-off event invents a repeat');
  assert.equal(bare.until, null, 'an event with no time gets a closing time');
  // Zero and nonsense are not crowds.
  assert.equal(crowdWord(0), null);
  assert.equal(crowdWord(-5), null);
  assert.equal(crowdWord(undefined), null);
  assert.equal(crowdWord(18434), '18,434');
});

it('the screen renders the pitch, and only where there is nothing to book', () => {
  assert.match(screen, /hostPitch\(ev, EVENTS, startOf, formatWhen\)/, 'the pitch is never built');
  assert.match(screen, /hasBookable \? null : hostPitch/,
    'the ask is computed even where a space is already bookable');
  assert.match(screen, /pitch\?\.crowd &&/, 'the crowd is not shown');
  assert.match(screen, /pitch\?\.repeat/, 'the second date is not shown');
  assert.match(screen, /pitch\?\.until &&/, 'the closing time is not shown');
  assert.match(screen, /two nights, not one/, 'the repeat is mentioned without making the point of it');
});

console.log(`\n  ${passed} checks passed\n`);
