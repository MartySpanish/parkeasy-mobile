// Belfast City Council's own rules, and the two places ParkEasy was silent.
//
// Taken from the council's car parks page, not inferred. Two rules matter:
//
//   1. "All charged car parks (EXCEPT Corporation Square, Corporation Street
//      and Smithfield) are open and free to use outside of charged hours."
//
//      So in Belfast, "charged Mon-Sat 8am-6pm" normally DOES mean free after
//      six — which is precisely why the three exceptions are dangerous. Our
//      Smithfield entry stated its hours and nothing else, and a driver reads
//      that as free in the evening because everywhere else it is. Same shape
//      as Junction One: accurate hours, wrong inference, £90 ticket.
//
//   2. On six published dates a year EVERY council car park is free, charged
//      ones included. A real fact a driver can act on, and nobody told them.
//
// THE PAGE CONTRADICTS ITSELF: one line names three exceptions, a later line
// names only Smithfield. Where an official source is inconsistent about
// whether parking is free, the safe reading is the one that cannot cost a
// driver a ticket. All three are treated as exceptions, and this file holds
// that decision in place.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const {
  councilFreeDay, isCouncilCarPark, chargesOutsideHours,
  COUNCIL_FREE_DAYS, NOT_FREE_OUTSIDE_HOURS, COVERED_UNTIL,
} = await import('../../src/data/councilCarParks.js');
const app = readFileSync(new URL('../../src/App.jsx', import.meta.url), 'utf8');
const src = readFileSync(new URL('../../src/data/councilCarParks.js', import.meta.url), 'utf8');

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };

console.log('\ncouncilCarParks — the council\'s rules, stated rather than implied');

it('all three named exceptions keep charging, not just Smithfield', () => {
  // The conservative reading of a self-contradicting official page.
  for (const name of ['Corporation Square', 'Corporation Street', 'Smithfield']) {
    assert.ok(chargesOutsideHours({ name: `${name} car park` }),
      `${name} is no longer treated as an exception — the page names it, so a driver could be charged`);
  }
  assert.equal(NOT_FREE_OUTSIDE_HOURS.length, 3,
    'the exception list changed size — the council page named three, and dropping one risks a ticket');
});

it('every other council car park is free after hours, or the warning means nothing', () => {
  for (const name of ['Kent Street car park', 'Little Donegall Street car park',
                      'Exchange Street', 'Cromac Street', 'Ravenscroft Avenue car park']) {
    assert.ok(!chargesOutsideHours({ name }),
      `${name} has been marked an exception, which the council does not say`);
  }
  // A missing or junk name must not inherit the warning either.
  assert.equal(chargesOutsideHours(null), false);
  assert.equal(chargesOutsideHours({}), false);
});

it('the rule applies only to council car parks', () => {
  // It is the council's rule. Applying it to a Translink park-and-ride or a
  // private driveway would be inventing a policy for somebody else's land.
  assert.ok(isCouncilCarPark({ by: 'Belfast City Council' }));
  assert.ok(isCouncilCarPark({ by: 'belfast city council' }), 'the match is case-sensitive');
  assert.ok(!isCouncilCarPark({ by: 'Translink' }));
  assert.ok(!isCouncilCarPark({ by: 'Forestside' }));
  assert.ok(!isCouncilCarPark({ by: 'ParkEasy gem scout' }));
  assert.ok(!isCouncilCarPark({}), 'a spot with no attribution is treated as council-run');
  assert.ok(!isCouncilCarPark(null));
});

it('the published free days are matched exactly', () => {
  // The ALLOCATED holiday, which is the day the machines are actually off —
  // Boxing Day falls on a Saturday in 2026 and the council allocates the 28th.
  assert.equal(councilFreeDay('2026-12-25').name, 'Christmas Day');
  assert.equal(councilFreeDay('2026-12-28').name, 'Boxing Day holiday');
  assert.equal(councilFreeDay('2027-01-01').name, "New Year's Day");
  assert.equal(councilFreeDay('2026-07-13').name, '12 July holiday');
  // The nominal date is NOT the free one when the council allocated another.
  assert.equal(councilFreeDay('2026-12-26'), false,
    'the nominal Boxing Day is claimed free — the council allocated the 28th and the machines run on the 26th');
  assert.equal(councilFreeDay('2026-10-05'), false, 'an ordinary day is claimed free');
  assert.equal(COUNCIL_FREE_DAYS.length, 6, 'the published list of six dates changed size');
});

it('past the end of the list it says "do not know", never "chargeable"', () => {
  // The list runs out. Answering false past that point is a claim we cannot
  // support — next year's holidays are not published here.
  assert.equal(councilFreeDay('2028-03-01'), null,
    'a date past the published list is reported as a normal charging day');
  assert.equal(councilFreeDay(`${COVERED_UNTIL}`).name, "New Year's Day");
  // One day past the last covered date is already unknown.
  const after = new Date(`${COVERED_UNTIL}T00:00:00Z`);
  after.setUTCDate(after.getUTCDate() + 1);
  assert.equal(councilFreeDay(after.toISOString().slice(0, 10)), null,
    'the day after the list ends is still being answered');
});

it('a Date is read in local time, not UTC', () => {
  // A driver at 00:30 on Christmas Day is on the 25th. toISOString() would
  // hand them the 24th and hide the free day.
  //
  // RUN IN A CHILD PROCESS WITH A NON-UTC TZ. This container runs UTC, where
  // local and UTC dates are identical — so the obvious in-process version of
  // this check passes even with toISOString(), which a mutation proved. Under
  // UTC+13 a local 00:30 on the 25th is 11:30 on the 24th in UTC, which is
  // exactly the bug.
  const probe = `
    import { councilFreeDay } from '${new URL('../../src/data/councilCarParks.js', import.meta.url).pathname}';
    const d = new Date(2026, 11, 25, 0, 30);
    process.stdout.write(JSON.stringify({
      tzOffsetMin: d.getTimezoneOffset(),
      utcDate: d.toISOString().slice(0, 10),
      got: councilFreeDay(d)?.name ?? null,
    }));
  `;
  const out = execFileSync(process.execPath, ['--input-type=module', '-e', probe],
    { env: { ...process.env, TZ: 'Pacific/Auckland' }, encoding: 'utf8' });
  const r = JSON.parse(out);
  // Guard the guard: if the child did not actually land in a non-UTC zone the
  // assertion below proves nothing, so fail loudly instead.
  assert.notEqual(r.tzOffsetMin, 0, 'the child process ran in UTC, so this check cannot detect the bug');
  assert.equal(r.utcDate, '2026-12-24', 'the fixture no longer straddles the UTC date boundary');
  assert.equal(r.got, 'Christmas Day',
    'the date is read in UTC, so a driver just after midnight is told the wrong day');

  // The implementation must use local date parts, not toISOString(). Comments
  // stripped first: the file's own comment explains why toISOString is wrong,
  // and matching that was a false failure.
  const code = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(code, /toISOString/,
    'councilCarParks.js is back to toISOString(), which reads the wrong local day');
  assert.match(code, /getFullYear\(\)/, 'the local-date path is gone');

  assert.equal(councilFreeDay('not a date'), null);
  assert.equal(councilFreeDay(new Date('nonsense')), null);
});

it('both notices render, scoped to council car parks, and never together', () => {
  assert.match(app, /isCouncilCarPark\(spot\) && councilFreeDay\(\)/,
    'the free-day notice is not scoped to council car parks');
  assert.match(app, /isCouncilCarPark\(spot\) && chargesOutsideHours\(spot\) && !councilFreeDay\(\)/,
    'the evening warning shows on a day when the council is not charging anyway, which contradicts the notice above it');
  assert.match(app, /Free all day today/, 'the free-day notice is gone');
  assert.match(app, /Not free in the evening/, 'the evening warning is gone');
});

console.log(`\n  ${passed} checks passed\n`);
