// The two questions checkout never asked about the clock.
//
// On 7 August two drivers paid for Michael Davitt GAC. On the 8th they arrived
// to locked gates: the slots were sold with thirteen hours' notice on a Friday
// night, and a volunteer committee did not see the email in time. Those are the
// only two real bookings ParkEasy has ever taken, so that is a 100% fulfilment
// failure on genuine revenue.
//
// Separately, booking f5e47473 was created at 14:09 on 4 August for a window
// that opened at 08:00 the same morning. create-session.js parsed the start
// time, checked it for NaN, and then never compared it with the clock again.
//
// Every assertion below was checked by breaking the rule it covers and watching
// it fail. The notes say which mutation.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  startTimeRefusal, slotEndMs, noticeMs, PAST_GRACE_MS, MAX_NOTICE_HOURS,
} from '../../src/data/bookingLeadTime.js';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
/** Source with // comments stripped: a regex must match the code, not a note about it. */
const code = p => read(p).split('\n').filter(l => !/^\s*(\/\/|--)/.test(l)).join('\n');

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };

console.log('\nbookingLeadTime — do not sell a slot the host cannot honour');

const H = 3600000;
// A Friday evening, which is when the real failure happened.
const FRI_2030 = Date.parse('2026-08-07T19:30:00Z');
const hourly = { spanMs: 2 * H, days: 0, dayPriced: false };
// Davitt Park: gates 9am–8.30pm, one day.
const gateDay = { spanMs: 11.5 * H, days: 1, dayPriced: true };

//------------------------------------------------------------- 1. already over
it('an hourly slot that has finished is refused', () => {
  // Mutation: `<= nowMs` → `< 0`. This passes, 2 and 10 fail.
  const r = startTimeRefusal({ startMs: FRI_2030 - 5 * H, nowMs: FRI_2030, ...hourly });
  assert.equal(r?.code, 'slot_in_past', JSON.stringify(r));
  assert.match(r.error, /already passed/i);
});

it('a gate window that closed yesterday is refused', () => {
  // Mutation: exempting dayPriced from rule 1. Caught here.
  const r = startTimeRefusal({
    startMs: Date.parse('2026-08-06T08:00:00Z'), nowMs: FRI_2030, ...gateDay,
  });
  assert.equal(r?.code, 'slot_in_past', JSON.stringify(r));
});

it('a gate window still open is sellable even though it opened this morning', () => {
  // The case rule 2 must NOT catch: arriving at 2pm into a 9am–8.30pm car park
  // is how a matchday space is normally used.
  // Mutation: drop the `!dayPriced` on rule 2 → this fails with start_in_past.
  const twoPm = Date.parse('2026-08-07T13:00:00Z');
  assert.equal(startTimeRefusal({
    startMs: Date.parse('2026-08-07T08:00:00Z'), nowMs: twoPm, ...gateDay,
  }), null);
});

it('a multi-day booking ends at the last day close, not start + 24h x days', () => {
  // Mutation: `(days - 1) * 86400000` → `days * 86400000`. A 3-day booking
  // would then look 11.5 hours longer than it is and a finished slot would
  // still be on sale.
  const start = Date.parse('2026-08-07T08:00:00Z');
  assert.equal(slotEndMs(start, 11.5 * H, 3, true), start + 11.5 * H + 2 * 86400000);
  assert.equal(slotEndMs(start, 2 * H, 0, false), start + 2 * H, 'hourly gained days');
});

//---------------------------------------------------------- 2. start in the past
it('the real past-dated booking is now refused', () => {
  // f5e47473, exactly as the database holds it: created 14:09, start 08:00 the
  // same day. Priced hourly for one hour, so it was over by six hours.
  const r = startTimeRefusal({
    startMs: Date.parse('2026-08-04T08:00:00Z'),
    nowMs: Date.parse('2026-08-04T14:09:46Z'),
    spanMs: 1 * H, days: 0, dayPriced: false,
  });
  assert.ok(r, 'the booking that is in the database was accepted again');
  assert.equal(r.code, 'slot_in_past');
});

it('an hourly start ten minutes gone is refused even while the hour runs', () => {
  // Mutation: delete rule 2 entirely. The slot has not ended, so rule 1 lets
  // it through and this is the only check that catches it.
  const r = startTimeRefusal({ startMs: FRI_2030 - 10 * 60000, nowMs: FRI_2030, ...hourly });
  assert.equal(r?.code, 'start_in_past', JSON.stringify(r));
});

it('a minute of clock skew is not treated as a sale of the past', () => {
  // Mutation: `PAST_GRACE_MS` → 0. This fails: a browser a minute fast would
  // be refused its own booking.
  assert.ok(PAST_GRACE_MS >= 60000, 'grace is under a minute of skew');
  assert.equal(startTimeRefusal({
    startMs: FRI_2030 - 60000, nowMs: FRI_2030, ...hourly,
  }), null);
});

//-------------------------------------------------------------- 3. notice period
it('the 8 August booking that found locked gates is refused', () => {
  // Sold 19:30 UTC Friday for 08:30 Saturday: thirteen hours. Against the 24 hours
  // Davitt Park now carries, this is the exact booking that must not happen.
  const r = startTimeRefusal({
    startMs: Date.parse('2026-08-08T08:30:00Z'), nowMs: FRI_2030,
    ...gateDay, listing: { min_notice_hours: 24 },
  });
  assert.equal(r?.code, 'too_soon', JSON.stringify(r));
  assert.match(r.error, /24 hours/, r.error);
  // Names a moment the driver can act on rather than only refusing. The HOUR
  // matters: 24 hours from 8:30pm Friday (19:30 UTC, BST) is 8:30pm SATURDAY, and
  // they just asked for Saturday morning. Mutation: drop the time from
  // prettyWhen and the sentence reads 'earliest is Saturday 8 August' to
  // somebody who asked for Saturday 8 August.
  assert.match(r.error, /earliest you can book is Saturday 8 August at 8:30pm/, r.error);
});

it('the notice window is a boundary, not a vibe', () => {
  const start = FRI_2030 + 24 * H;
  const listing = { min_notice_hours: 24 };
  // Mutation: `<` → `<=` makes the exact boundary fail; `< need` → `< need / 2`
  // makes the hour-short case pass.
  assert.equal(startTimeRefusal({ startMs: start, nowMs: FRI_2030, ...gateDay, listing }), null,
    'exactly 24 hours of notice was refused');
  assert.equal(startTimeRefusal({
    startMs: start - 60000, nowMs: FRI_2030, ...gateDay, listing,
  })?.code, 'too_soon', 'a minute short of 24 hours was allowed');
});

it('the earliest-date sentence is in the host city, not the server timezone', () => {
  // Mutation: drop `timeZone: 'Europe/London'` from prettyDay. This container
  // runs UTC, where the moment below is still 8 August; in Belfast it is the
  // 9th. Without the option the sentence names the wrong day to a driver.
  const r = startTimeRefusal({
    // now + 24h lands on 2026-08-08T23:30Z, which is 00:30 on the 9th in
    // Belfast and still the 8th in UTC.
    startMs: Date.parse('2026-08-08T22:00:00Z'),
    nowMs: Date.parse('2026-08-07T23:30:00Z'),
    ...gateDay, listing: { min_notice_hours: 24 },
  });
  assert.equal(r?.code, 'too_soon', JSON.stringify(r));
  assert.match(r.error, /Sunday 9 August at 12:30am/, r.error);
});

it('no notice column means no notice requirement', () => {
  // Shipping the module before the migration, or before anyone sets a number,
  // must not take a space off sale. Mutation: default `noticeMs` to anything
  // above 0 and this fails four ways.
  const soon = FRI_2030 + 30 * 60000;
  for (const listing of [null, undefined, {}, { min_notice_hours: null },
    { min_notice_hours: 0 }, { min_notice_hours: -5 }, { min_notice_hours: 'soon' }]) {
    assert.equal(startTimeRefusal({ startMs: soon, nowMs: FRI_2030, ...gateDay, listing }), null,
      `took a space off sale for min_notice_hours=${JSON.stringify(listing)}`);
  }
  assert.equal(noticeMs({ min_notice_hours: -5 }), 0);
  assert.equal(noticeMs({ min_notice_hours: 'soon' }), 0);
});

it('an absurd notice period is clamped rather than trusted', () => {
  // Mutation: drop the Math.min. A fat-fingered 10000 would then put the space
  // a year out of reach with no error anywhere.
  assert.equal(noticeMs({ min_notice_hours: 10000 }), MAX_NOTICE_HOURS * H);
  assert.equal(MAX_NOTICE_HOURS, 336, 'the ceiling moved without the migration moving');
});

it('a slot that is both over and short of notice says it is over', () => {
  // The clearer sentence wins. Mutation: move the notice check above rule 1 and
  // the driver is told to book a day ahead of a date that has already gone.
  const r = startTimeRefusal({
    startMs: FRI_2030 - 5 * H, nowMs: FRI_2030, ...hourly,
    listing: { min_notice_hours: 24 },
  });
  assert.equal(r?.code, 'slot_in_past', JSON.stringify(r));
});

//------------------------------------------------------------- 4. actually wired
it('create-session.js runs the guard, and does it before taking money', () => {
  const src = code('../../api/checkout/create-session.js');
  assert.match(src, /import \{ startTimeRefusal \} from '\.\.\/\.\.\/src\/data\/bookingLeadTime\.js'/,
    'the endpoint no longer imports the guard');
  assert.match(src, /startTimeRefusal\(\{[\s\S]{0,200}?listing,?\s*\}\)/,
    'the guard is called without the listing, so no notice period can apply');
  assert.match(src,
    /if \(refusal\) return res\.status\(400\)\.json\(\{ error: refusal\.error, code: refusal\.code \}\)/,
    'the refusal is computed and ignored, or has lost the code that stops it '
    + 'being shown to the driver as a card decline');
  // Order matters: refusing after a Stripe session exists would leave a
  // half-made checkout behind.
  assert.ok(src.indexOf('startTimeRefusal(') < src.indexOf('stripe.checkout.sessions.create'),
    'the clock is checked after the Stripe session is created');
  assert.ok(src.indexOf('startTimeRefusal(') < src.indexOf('from=public.bookings')
    || src.indexOf('startTimeRefusal(') < src.indexOf('/rest/v1/bookings'),
    'the clock is checked after the overlap queries');
});

it('the migration defaults to nothing and bounds what can be set', () => {
  const sql = code('../../supabase/migrations/20261007_listing_min_notice.sql');
  assert.match(sql, /add column if not exists min_notice_hours integer not null default 0/,
    'the column no longer defaults to 0 — applying it could take listings off sale');
  assert.match(sql, /min_notice_hours >= 0 and min_notice_hours <= 336/,
    'the range check is gone or disagrees with MAX_NOTICE_HOURS');
  // The one listing we know was burned, and only that one.
  assert.match(sql, /set min_notice_hours = 24\s*\n\s*where title = 'Michael Davitt GAC/,
    'Davitt Park no longer gets the notice period that the 8 August failure earned');
  assert.ok(!/update public\.rental_listings\s*\n\s*set min_notice_hours = 24;\s*$/m.test(sql),
    'the update has lost its WHERE and now applies to every listing');
});

console.log(`\n  ${passed} checks passed\n`);
