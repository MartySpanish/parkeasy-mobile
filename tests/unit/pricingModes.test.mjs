// Hourly, per-day, or both — and which one the driver is actually charged.
//
// A listing may now publish two rates. That makes "which rate applies" a real
// decision instead of a property of the row, and it is a decision about money
// taken on a server that must not trust the client. The rule:
//
//   day rate only            -> always day-priced
//   hourly only              -> always hourly, whatever the client asks for
//   both                     -> the driver's `unit` decides, defaulting hourly
//
// The middle line is the one worth a test. `unit` arrives in the request body,
// so a listing with no day rate must not become day-priced just because
// somebody posted unit:'day' — and the server must never read a PRICE from the
// client, only choose between two the host already published.
//
// The server's rule is extracted and executed here rather than eyeballed, so
// this fails on a real change in behaviour rather than on wording.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../../api/checkout/create-session.js', import.meta.url), 'utf8');
const app    = readFileSync(new URL('../../src/App.jsx', import.meta.url), 'utf8');
const notify = readFileSync(new URL('../../src/notify.js', import.meta.url), 'utf8');
const hosts  = readFileSync(new URL('../../public/hosts.html', import.meta.url), 'utf8');

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };

console.log('\npricingModes — two rates, and which one gets charged');

// ── The server's decision, executed ──────────────────────────────────────────
const srcOf = (re, where, label) => re.exec(where)?.[1] ?? assert.fail(`${label} not found`);
const hasHourSrc = srcOf(/const hasHour = ([^;]+);/, server, 'hasHour');
const hasDaySrc  = srcOf(/const hasDay  = ([^;]+);/, server, 'hasDay');
const wantsDaySrc= srcOf(/const wantsDay  = ([^;]+);/, server, 'wantsDay');
const dayPricedSrc = srcOf(/const dayPriced = ([^;]+);/, server, 'dayPriced');

const serverDayPriced = new Function('listing', 'req', `
  const hasHour = ${hasHourSrc};
  const hasDay  = ${hasDaySrc};
  const wantsDay  = ${wantsDaySrc};
  return ${dayPricedSrc};
`);

const CASES = [
  ['day rate only, no unit',        { price_per_day: 20 },                 undefined, true ],
  ['day rate only, unit=hour',      { price_per_day: 20 },                 'hour',    true ],
  ['hourly only, no unit',          { price_per_hour: 3 },                 undefined, false],
  ['hourly only, unit=day forged',  { price_per_hour: 3 },                 'day',     false],
  ['both, no unit (default hourly)',{ price_per_hour: 3, price_per_day: 20 }, undefined, false],
  ['both, unit=hour',               { price_per_hour: 3, price_per_day: 20 }, 'hour',   false],
  ['both, unit=day',                { price_per_hour: 3, price_per_day: 20 }, 'day',    true ],
  ['both, unit=DAY (case)',         { price_per_hour: 3, price_per_day: 20 }, 'DAY',    true ],
  ['both, unit=nonsense',           { price_per_hour: 3, price_per_day: 20 }, 'weekly', false],
];

for (const [name, listing, unit, expected] of CASES) {
  it(`server: ${name} -> ${expected ? 'day' : 'hourly'}`, () => {
    assert.equal(serverDayPriced(listing, { body: { unit } }), expected);
  });
}

it('server: a zero or negative rate does not count as a rate', () => {
  assert.equal(serverDayPriced({ price_per_hour: 0, price_per_day: 20 }, { body:{} }), true);
  assert.equal(serverDayPriced({ price_per_hour: 3, price_per_day: 0 },  { body:{unit:'day'} }), false);
});

it('server: a listing with neither rate is refused before pricing', () => {
  assert.match(server, /if \(!hasHour && !hasDay\) \{[\s\S]{0,120}has no price set/,
    'the no-price guard no longer covers both rates');
});

it('the client sends unit as an enum, never a price', () => {
  assert.match(notify, /unit: unit === 'day' \? 'day' : 'hour'/,
    'createBookingSession no longer normalises unit to an enum');
  const body = /body: JSON\.stringify\(\{([\s\S]*?)\}\),/.exec(notify)?.[1] ?? '';
  assert.ok(!/price/i.test(body), 'the checkout body carries a price — the server must own that');
});

// ── The listing form ─────────────────────────────────────────────────────────
it('the form only publishes the rates its mode selected', () => {
  // A host who types an hourly rate, switches to "per day" and publishes must
  // not ship the abandoned hourly rate — it is the one the server defaults to.
  assert.match(app, /price_per_hour: wantsHour \? num\(f\.price_per_hour\) : null/,
    'the hourly rate is no longer gated on the chosen mode');
  assert.match(app, /price_per_day:  wantsDay  \? num\(f\.price_per_day\)  : null/,
    'the day rate is no longer gated on the chosen mode');
});

it('the day rate is actually persisted', () => {
  const at = app.indexOf('const buildRow = (status) => ({');
  assert.ok(at !== -1, 'buildRow not found');
  const body = app.slice(at, app.indexOf('\n  });', at));
  assert.match(body, /price_per_day: listingShape\.price_per_day/,
    'buildRow drops the day rate — the host sets it and it never reaches the row');
});

it('both minimums are enforced, and a day must beat an hour', () => {
  const at = app.indexOf('const checkRequirements = (l) => {');
  const body = app.slice(at, app.indexOf('\n};', at));
  assert.match(body, /MIN_PRICE_PER_HOUR/, 'the hourly minimum is gone');
  assert.match(body, /MIN_PRICE_PER_DAY/,  'the day minimum is gone');
  assert.match(body, /price_per_day\) <= Number\(l\.price_per_hour\)/,
    'a day rate at or below the hourly rate is no longer rejected');
});

it('the sheet asks the driver only when there is a choice', () => {
  assert.match(app, /const bothRates = hasHour && hasDay;/, 'bothRates not found');
  assert.match(app, /\{bothRates && \(/, 'the rate toggle is not gated on both rates existing');
  // Switching must reset the quantity: "2" is two hours or two DAYS.
  assert.match(app, /setUnit\(o\.k\); setHours\(o\.k === 'day' \? 1 : 2\);/,
    'switching rate no longer resets the quantity — 2 hours becomes 2 days');
});

// ── The calculator ───────────────────────────────────────────────────────────
it('the calculator multiplies by hours only in hourly mode', () => {
  assert.match(hosts, /var perOpening = mode === 'hour' \? price \* hours : price;/,
    'the calculator no longer models an hourly day');
  assert.match(hosts, /id="hoursField" hidden/, 'the hours slider is not hidden by default');
});

console.log(`\n  ${passed} checks passed\n`);
