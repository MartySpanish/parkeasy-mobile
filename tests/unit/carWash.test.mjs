// The cutoff and the per-site days — the two rules that decide whether a driver
// is offered a wash at all.
import assert from 'node:assert/strict';
import { availableWashDates, washDaysLabel, WASH_TIERS, CUTOFF_HOURS } from '../../src/data/carWash.js';

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };

console.log('\ncarWash — which dates a driver can ask for');

// Friday 21 August 2026, 10am local.
const friday = new Date(2026, 7, 21, 10, 0, 0);

it('offers Mondays only, at a Mondays site', () => {
  for (const d of availableWashDates([1], friday)) {
    assert.equal(new Date(`${d}T00:00:00`).getDay(), 1, `${d} is not a Monday`);
  }
});

it('the first Monday offered is more than 24h away', () => {
  const first = availableWashDates([1], friday)[0];
  assert.ok(new Date(`${first}T00:00:00`).getTime() - friday.getTime() > CUTOFF_HOURS * 3600000);
});

it('a Sunday-evening request loses the next morning', () => {
  // Sunday 23 August, 6pm — Monday the 24th is 6 hours away, inside the cutoff.
  const sundayEvening = new Date(2026, 7, 23, 18, 0, 0);
  const dates = availableWashDates([1], sundayEvening);
  assert.ok(!dates.includes('2026-08-24'), 'tomorrow morning is not enough notice for a valeter');
  assert.equal(dates[0], '2026-08-31');
});

it('a Sunday-morning request keeps the next day, just', () => {
  // Sunday 23 August, 00:00 — Monday starts exactly 24h later, which is not
  // LESS than the cutoff, so it stands.
  const sundayMidnight = new Date(2026, 7, 23, 0, 0, 0);
  assert.equal(availableWashDates([1], sundayMidnight)[0], '2026-08-24');
});

it('an event site on Sundays gets Sundays, not Mondays', () => {
  for (const d of availableWashDates([7], friday)) {
    assert.equal(new Date(`${d}T00:00:00`).getDay(), 0);
  }
});

it('a site washing twice a week offers both', () => {
  const days = new Set(availableWashDates([1, 7], friday).map(d => new Date(`${d}T00:00:00`).getDay()));
  assert.deepEqual([...days].sort(), [0, 1]);
});

it('offers nothing when the site washes on no days at all', () => {
  assert.deepEqual(availableWashDates([], friday), []);
});

console.log('\n  wording and prices');
it('names the days in plain English', () => {
  assert.equal(washDaysLabel([1]), 'Mondays');
  assert.equal(washDaysLabel([1, 7]), 'Mondays and Sundays');
  assert.equal(washDaysLabel([1, 3, 5]), 'Mondays, Wednesdays and Fridays');
  assert.equal(washDaysLabel([]), 'selected days');
});

it('prices are whole pence and in the briefed order', () => {
  assert.deepEqual(WASH_TIERS.map(t => t.pricePence), [3000, 4000, 5000]);
  for (const t of WASH_TIERS) assert.equal(t.pricePence, Math.round(t.pricePence));
});

console.log(`\n${passed} checks passed\n`);
