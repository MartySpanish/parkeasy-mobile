// What a host is told about the driver coming through their gate.
//
// The ratings table has collected host→driver scores since 27 July and nobody
// could read them: driver_profiles' only policy is "own driver profile
// readable", so the one person who could see a driver's score was that driver.
// The migration that built it said what should happen next — "later as an input
// to a host-side risk flag" — and that later never came. Half a trust system,
// gathered and binned, and the missing half is the half that helps SUPPLY: a
// parish treasurer's question is not what the space earns, it is who drives
// through our gate.
//
// THE DANGEROUS PART IS THE EMPTY STATE, NOT THE QUERY. There are 0 host→driver
// ratings in the database right now, so every arrival comes back with nothing.
// That must read as a fact about a new driver and never as reassurance or as a
// warning — both would be invented, in front of somebody deciding whether to
// let a stranger onto their property. These checks hold that line.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { reputationLine, byBooking, RATING_FLOOR } =
  await import('../../src/data/driverReputationCore.js');
const app = readFileSync(new URL('../../src/App.jsx', import.meta.url), 'utf8');
const mig = readFileSync(
  new URL('../../supabase/migrations/20261005_driver_reputation_for_host.sql', import.meta.url), 'utf8');

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };

console.log('\ndriverReputation — say what is known, and nothing else');

it('no data says so, and does not reassure or warn', () => {
  // The live case today: nobody has ever been rated.
  const fresh = reputationLine({ stars: null, ratings: 0, stays: 0, newcomer: true });
  assert.equal(fresh.stars, null, 'a score is shown for a driver who has none');
  assert.equal(fresh.label, 'First stay');
  // Neither of these words may appear — one is reassurance we cannot give, the
  // other an accusation we cannot support.
  assert.doesNotMatch(fresh.label, /unrated|no rating|caution|care|risk|trusted|verified|fine|good/i,
    'the empty state passes a judgement instead of stating a fact');
  assert.equal(fresh.tone, 'neutral', 'an unrated driver is given a non-neutral tone');
});

it('a missing row is null, not an invented default', () => {
  // A booking that predates driver accounts, or a guest checkout: the RPC
  // returns no row at all. Showing "First stay" there would be a claim about
  // somebody we know nothing about.
  assert.equal(reputationLine(null), null);
  assert.equal(reputationLine(undefined), null);
});

it('a score appears only at or above the floor', () => {
  // One rating is one identifiable host's opinion of a named person. The
  // database withholds the average below the floor; this must not reconstruct
  // it from whatever leaked through.
  assert.equal(RATING_FLOOR, 2, 'the floor moved without the reasoning being revisited');
  const one = reputationLine({ stars: 1.0, ratings: 1, stays: 1, newcomer: true });
  assert.equal(one.stars, null, 'a single rating is shown as a reputation');
  // A distinctive score, so "leaked" cannot be confused with an unrelated digit
  // in "1 previous stay". 2.7 appears nowhere else in the expected output.
  const leaky = reputationLine({ stars: 2.7, ratings: 1, stays: 1, newcomer: true });
  assert.equal(leaky.stars, null, 'the suppressed score survives on the row');
  assert.doesNotMatch(leaky.label, /2\.7|★/, 'the suppressed score leaks into the label');
  const two = reputationLine({ stars: 4.5, ratings: 2, stays: 2, newcomer: false });
  assert.equal(two.stars, 4.5, 'a driver at the floor is still shown as unrated');
  assert.match(two.label, /4\.5 ★/, 'the score is not shown once it is allowed');
  assert.match(two.label, /2 ratings/, 'the host cannot see how many ratings it is based on');
});

it('the stay count is the fact offered instead of a score', () => {
  const some = reputationLine({ stars: null, ratings: 1, stays: 3, newcomer: true });
  assert.match(some.label, /3 previous stays/, 'a driver with history is shown as a first-timer');
  assert.equal(reputationLine({ stars: null, ratings: 0, stays: 1, newcomer: true }).label,
    '1 previous stay', 'the singular is wrong, which reads as sloppy on a trust signal');
  // Nonsense never becomes a number — in the label OR in the field behind it.
  // Checking only the label let a negative count through the object unnoticed.
  for (const bad of [null, undefined, -4, 0, NaN, 'lots']) {
    const r = reputationLine({ stars: null, ratings: 0, stays: bad, newcomer: true });
    assert.equal(r.label, 'First stay', `stays=${String(bad)} produced a stay count`);
    assert.equal(r.stays, 0, `stays=${String(bad)} survived as ${r.stays} on the returned row`);
  }
  // And a real count is carried through as a number, or the clamp above could
  // be "always return 0" and still pass.
  assert.equal(reputationLine({ stars: null, ratings: 0, stays: 7, newcomer: true }).stays, 7,
    'a genuine stay count is being clamped away');
});

it('rows are indexed by booking, order-independent and junk-tolerant', () => {
  const m = byBooking([{ booking_id: 'b', stays: 2 }, { booking_id: 'a', stays: 1 }, null, {}, 'x']);
  assert.equal(m.get('a').stays, 1);
  assert.equal(m.get('b').stays, 2);
  assert.equal(m.size, 2, 'a malformed row became an entry');
  assert.equal(byBooking(null).size, 0);
  assert.equal(byBooking('nope').size, 0);
});

it('the database only ever answers for the caller\'s own bookings', () => {
  // The access rule is the whole feature. If this clause goes, the function
  // becomes a reputation lookup on any booking id in the system.
  assert.match(mig, /and b\.host_id = auth\.uid\(\)/,
    'driver_reputation no longer restricts rows to the caller\'s own bookings');
  assert.match(mig, /b\.id = any\(coalesce\(p_booking_ids/,
    'the function no longer takes explicit booking ids, so it can be enumerated');
  assert.match(mig, /security definer/, 'the function cannot read past RLS, so it returns nothing');
  assert.match(mig, /set search_path = public, pg_temp/, 'a definer function with no pinned search_path');
  // Aggregates only. None of these columns may be selected out to a host.
  assert.doesNotMatch(mig, /select[\s\S]*\b(r\.comment|driver_email|b\.driver_email)\b/i,
    'review text or a driver email is being returned to the host');
  // anon has no auth.uid(), so it would get nothing — but say it explicitly.
  assert.doesNotMatch(mig, /grant execute on function public\.driver_reputation\(uuid\[\]\) to [^;]*anon/,
    'driver_reputation is granted to anon');
  assert.match(mig, /grant execute on function public\.driver_reputation\(uuid\[\]\) to authenticated/,
    'no role can call it, so the feature is dead');
});

it('the floor in the code and the floor in the database are the same number', () => {
  const sql = /create or replace function public\.driver_rating_floor\(\)[\s\S]*?select (\d+)/.exec(mig);
  assert.ok(sql, 'driver_rating_floor() is gone from the migration');
  assert.equal(Number(sql[1]), RATING_FLOOR,
    'the SQL floor and the JS floor disagree — one of them is suppressing a score the other shows');
});

it('the host screen renders it, with no risk colouring', () => {
  assert.match(app, /reputationLine\(reps\?\.get\(b\.id\)\)/, 'the arrivals list never builds the line');
  assert.match(app, /supabase\.rpc\('driver_reputation', \{ p_booking_ids: ids \}\)/,
    'the reputation is never fetched');
  // Green for a real rating and plain grey otherwise. No amber/red verdict.
  assert.doesNotMatch(app, /rep\.tone === 'rated'[\s\S]{0,400}(text-red|border-red|bg-red)/,
    'a red risk badge has been added — that is an accusation about a named person');
});

console.log(`\n  ${passed} checks passed\n`);
