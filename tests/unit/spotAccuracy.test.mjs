// Two spots that were telling drivers something untrue, and the shape of the
// mistake behind both.
//
// ParkEasy's entire claim is that its spots are RIGHT. A wrong restriction is
// not a cosmetic bug — it is a £90 ticket, or in the Antrim case a £100 one.
// Both entries below were written when they were true and quietly rotted:
//
//   Junction One (id 2048) said "Free for all users" with 1,700 spaces and
//   "plenty of capacity". All of that is true and none of it is the point: the
//   operator runs ANPR with a THREE HOUR max stay, 24 hours a day, and £100 for
//   an overstay. A driver trusting our entry for a night out gets charged.
//   Confirmed on the operator's own parking page.
//
//   Connswater (EV id 3048) hedged that the centre "is partially closing so
//   check current status". It closed permanently on 21 March 2025 after 42
//   years and has been reported since as abandoned. A hedge written before the
//   fact is not the same as the fact.
//
// THE GENERAL LESSON, which is what this file is really guarding: on a retail
// or supermarket car park, "free" and "unrestricted" are different claims, and
// the gap between them is exactly where tickets are issued. An entry may say
// free. It may not say free in a way that implies you can leave the car.
import assert from 'node:assert/strict';

const { EXTRA_SPOTS } = await import('../../src/extraSpots.js');
const { EV_SPOTS } = await import('../../src/evSpots.js');

const flat = (o) => Object.values(o).flat();
const all = [...flat(EXTRA_SPOTS), ...flat(EV_SPOTS)];
const byId = (id) => all.find((s) => s.id === id);

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };

console.log('\nspotAccuracy — free is not the same as unrestricted');

it('Junction One carries its 3-hour ANPR limit, not just "free"', () => {
  const s = byId(2048);
  assert.ok(s, 'the Junction One spot is gone');
  const field = `${s.restriction} ${s.notes}`;
  // The restriction FIELD specifically — that is what a driver reads on the
  // card before deciding to walk away from the car. Burying the limit in the
  // notes is how this went wrong the first time.
  assert.match(s.restriction, /3 ?hours?/i,
    'the restriction field no longer states the 3-hour limit — a driver reads this line, not the notes');
  assert.match(s.restriction, /ANPR/i, 'the restriction field does not mention ANPR enforcement');
  assert.ok(!/^Free for all users$/i.test(s.restriction.trim()),
    'the restriction is back to "Free for all users", which is what got drivers charged £100');
  // The consequence, so the warning has teeth.
  assert.match(field, /£100/, 'the £100 parking charge is not stated anywhere');
  assert.match(field, /24 hours a day|24\/7/i,
    'the limit is not stated as running 24/7 — a driver may assume it lapses after shop hours');
});

it('Connswater states the closure as fact, not as a hedge', () => {
  const s = byId(3048);
  assert.ok(s, 'the Connswater EV spot is gone');
  // "partially closing" was the hedge. The centre is shut.
  assert.ok(!/partially clos/i.test(s.notes),
    'the note is back to "partially closing" — the centre shut permanently in March 2025');
  assert.match(s.notes, /closed permanently/i, 'the permanent closure is no longer stated');
  assert.match(s.notes, /2025/, 'the closure date is gone, so a reader cannot judge how stale this is');
  // And it must not read as a working charger with nothing else said.
  assert.match(s.notes, /not guaranteed|may be unreachable/i,
    'the note no longer warns that access to the car park is not guaranteed');
});

it('no spot claims a retail car park is free AND unlimited in the same breath', () => {
  // The general form of the Junction One bug. A retail or supermarket car park
  // that promises free parking and says nothing about a stay limit is the
  // combination that generates charges — these sites are ANPR-enforced far
  // more often than not.
  //
  // Matched on the spot's OWN NAME, not on `near`. A council car park that
  // happens to sit behind a shopping centre is not retail land and is not
  // ANPR'd by the centre — Bann Boulevard in Portadown is exactly that case
  // (the council lists it as a free car park off Meadow Lane) and matching its
  // `near` field flagged it wrongly. The question is whether the SPOT IS the
  // retailer's car park, not whether a shop is nearby.
  const retail = all.filter((s) =>
    /retail park|shopping centre|outlet|superstore|tesco|sainsbury|asda|lidl|b&m/i
      .test(s.name));
  assert.ok(retail.length >= 3, `expected several retail car parks, found ${retail.length}`);

  const reassuring = /always spaces|plenty of capacity|leave it|all day|no limit|unlimited|as long as you like/i;
  const restricted = /max stay|maximum stay|hours?\b|ANPR|customer|signage|time limit|retail hours|opening hours/i;

  const unsafe = retail.filter((s) => {
    const text = `${s.restriction || ''} ${s.notes || ''}`;
    return reassuring.test(text) && !restricted.test(text);
  });
  assert.deepEqual(unsafe.map((s) => `${s.id} ${s.name}`), [],
    'a retail car park promises open-ended parking with no stay limit mentioned');
});

console.log(`\n  ${passed} checks passed\n`);
