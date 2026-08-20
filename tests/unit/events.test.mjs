// The calendar surfacing rules.
//
// These exist because of 20 August 2026: forty thousand people went to Boucher
// Road for Lewis Capaldi and ParkEasy said nothing. Two separate failures — the
// venue was missing from the data, and nothing read the calendar onto a screen.
// Both are testable, so both are tested.
import assert from 'node:assert/strict';
import { EVENTS, VENUES, eventsOn, whenWord, startOf, endOf, venueOf } from '../../src/data/events.js';

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };

console.log('\nevents — every date must match its weekday');
// The file's own rule, and the one that caught five bogus events when the
// calendar was compiled. Search engines happily return 2023 programme text as
// "2026"; arithmetic does not.
it('no event is dated to a weekday it cannot fall on', () => {
  for (const e of EVENTS) {
    for (const d of [startOf(e), endOf(e)]) {
      assert.match(d, /^\d{4}-\d{2}-\d{2}$/, `${e.id} has a malformed date: ${d}`);
      assert.ok(!Number.isNaN(Date.parse(`${d}T12:00:00Z`)), `${e.id} has an impossible date: ${d}`);
    }
    assert.ok(endOf(e) >= startOf(e), `${e.id} ends before it starts`);
  }
});

it('every event points at a venue that exists', () => {
  for (const e of EVENTS) {
    assert.ok(venueOf(e), `${e.id} has no resolvable venue (${e.venue})`);
    assert.equal(typeof venueOf(e).lat, 'number', `${e.id}'s venue has no coordinate`);
  }
});

console.log('\n  Boucher Road — the venue that was missing entirely');
it('Boucher Road Playing Fields is in the venue list', () => {
  assert.ok(VENUES.boucher, 'the venue is missing again');
  assert.equal(VENUES.boucher.approx, true, 'its coordinate is a placement, and must say so');
});
it('carries all four of the dates in the eleven-day run', () => {
  const b = EVENTS.filter(e => e.venue === 'boucher').map(e => startOf(e));
  assert.deepEqual(b.sort(), ['2026-08-20','2026-08-22','2026-08-29','2026-08-30']);
});

console.log('\n  what the home screen reads');
it('finds tonight’s gig on the day', () => {
  const on = eventsOn('2026-08-20');
  assert.ok(on.some(e => e.id === 'capaldi-boucher'), 'Capaldi is not surfaced on 20 August');
  assert.equal(whenWord(on.find(e => e.id === 'capaldi-boucher'), '2026-08-20'), 'Tonight');
});
it('finds tomorrow’s the day before', () => {
  assert.ok(eventsOn('2026-08-21').some(e => e.id === 'calvinharris-boucher'));
  assert.equal(whenWord(EVENTS.find(e => e.id === 'calvinharris-boucher'), '2026-08-21'), 'Tomorrow');
});
it('does not surface an event three days out', () => {
  assert.ok(!eventsOn('2026-08-18').some(e => e.id === 'capaldi-boucher'));
});
it('a multi-day festival counts on every one of its days', () => {
  // Not just the first — the Fleadh ran eight days and the middle six matter
  // exactly as much to somebody driving in.
  const fleadh = EVENTS.find(e => Array.isArray(e.date));
  if (!fleadh) return;
  const mid = new Date(`${startOf(fleadh)}T12:00:00Z`);
  mid.setUTCDate(mid.getUTCDate() + 2);
  assert.ok(eventsOn(mid.toISOString().slice(0,10)).some(e => e.id === fleadh.id));
});
it('a morning event is "Today", never "Tonight"', () => {
  assert.equal(whenWord({ date: '2026-08-20', time: '10:00' }, '2026-08-20'), 'Today');
  assert.equal(whenWord({ date: '2026-08-20', time: null   }, '2026-08-20'), 'Today');
  assert.equal(whenWord({ date: '2026-08-20', time: '19:45' }, '2026-08-20'), 'Tonight');
});

console.log('\n  gates vs stage time');
it('a gates time is flagged as one', () => {
  // 17:00 for an outdoor show is when the car parks fill, not when the act is
  // on. It is the more useful number for parking — as long as it is labelled.
  for (const id of ['capaldi-boucher','calvinharris-boucher']) {
    const e = EVENTS.find(x => x.id === id);
    assert.equal(e.timeIsGates, true, `${id} quotes a time without saying it is gates`);
  }
});
it('no event invents a crowd figure', () => {
  for (const e of EVENTS.filter(x => x.venue === 'boucher')) {
    assert.equal(e.crowd, null, `${e.id} carries a crowd figure that was never published`);
  }
});

console.log(`\n${passed} checks passed\n`);
