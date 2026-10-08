// What the booking path reads, what it is allowed to say, and the bug that
// lived entirely in the gap between the two.
//
// THE DEFECT. BookingSheet mirrors the checkout API's refusals so a driver is
// told on the date picker rather than after typing a registration and tapping
// Pay. Its own comment says so. That mirror reads listing.available_days,
// listing.extra_dates and listing.blocked_dates — and the MAP query, the
// primary way anybody finds a space, selected an explicit column list
// containing none of the three. So dateIsOpen() saw `undefined`, treated every
// day as open, and the driver was refused at the card form by the exact
// refusal the mirror exists to prevent. On the Rent tab, which uses
// select('*'), it worked perfectly. Nothing threw. Nothing looked wrong.
//
// min_notice_hours arrived the same way: the lead-time guard went into
// api/checkout/create-session.js and no client surface ever mentioned it.
//
// SO THE GUARD IS STRUCTURAL, not a list of the five columns that happened to
// be missing. BookingSheet is brace-matched out of App.jsx and every
// `listing.<field>` it reads must be a column the query selects. Add a field
// to the sheet without adding it to the list and this fails.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BOOKING_COLUMNS, BOOKING_SELECT, operatorFacts } from '../../src/data/listingFields.js';
import { noticeFloorDay, noticeMs } from '../../src/data/bookingLeadTime.js';

const app = readFileSync(new URL('../../src/App.jsx', import.meta.url), 'utf8');

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };

console.log('\nbookingColumns — the sheet can only promise what the query selected');

/**
 * A function body, by brace matching from a unique opening line.
 *
 * FROM THE ARROW, not from the first brace. `const BookingSheet = ({ listing,
 * onClose }) => {` opens a brace in its own parameter destructuring, so
 * matching from the first `{` returned `{ listing, onClose }` — a four-token
 * "body" in which no listing field is read, and every assertion below passed
 * vacuously. The `read.size >= 8` check is what caught it.
 */
function bodyOf(src, opener) {
  const start = src.indexOf(opener);
  assert.notEqual(start, -1, `could not find ${opener} in App.jsx`);
  const arrow = src.indexOf('=>', start);
  assert.notEqual(arrow, -1, `no arrow after ${opener}`);
  let i = src.indexOf('{', arrow), depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(i, j + 1); }
  }
  throw new Error(`unbalanced braces after ${opener}`);
}

const sheet = bodyOf(app, 'const BookingSheet = ({ listing, onClose }) => {');

// ── The structural guard ─────────────────────────────────────────────────────
it('every listing field BookingSheet reads is a column the query selects', () => {
  // JSX comments quote old copy and column names; strip them so a note about a
  // field is not mistaken for a read of it.
  const code = sheet.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');
  const read = new Set([...code.matchAll(/\blisting\.([a-z_][a-z0-9_]*)/g)].map(m => m[1]));
  assert.ok(read.size >= 8, `only ${read.size} listing fields found — the brace match probably failed`);
  const missing = [...read].filter(f => !BOOKING_COLUMNS.includes(f));
  assert.deepEqual(missing, [],
    `BookingSheet reads ${missing.join(', ')} but the query does not select it — on the map `
    + 'path that field is undefined and the sheet silently promises the wrong thing');
});

it('the five columns that were actually missing are in the list', () => {
  // Named explicitly as well as caught structurally, because these five are
  // the bug rather than an example of it.
  for (const c of ['available_days', 'extra_dates', 'blocked_dates',
                   'overnight_fee_pence', 'min_notice_hours']) {
    assert.ok(BOOKING_COLUMNS.includes(c), `${c} is not selected on the booking path`);
  }
});

it('the map query uses the shared list, not a list typed out again', () => {
  // Mutation: paste the old string back and this fails. A second hand-typed
  // list is how the first one drifted.
  assert.match(app, /\.select\(BOOKING_SELECT\)/,
    'the map query no longer uses BOOKING_SELECT');
  assert.ok(!/\.select\('id,title,address,lat,lng,price_per_hour/.test(app),
    'the hand-typed column list is back');
  assert.equal(BOOKING_SELECT, BOOKING_COLUMNS.join(','));
});

it('the private operational columns are NOT on a public read', () => {
  // supabase/migrations/20260728_security_and_integrity.sql exists to keep
  // these off a driver-visible query: how to get through a locked gate, and
  // whose mobile to ring. Widening the list must not quietly widen that.
  for (const c of ['access_method', 'access_contact_name', 'access_contact_phone',
                   'owner_id', 'needs_update']) {
    assert.ok(!BOOKING_COLUMNS.includes(c),
      `${c} is selected on a public read — it is operational detail, not a listing`);
  }
  // Free text whose own placeholder invites '"none — explain"', so it can hold
  // a sentence rather than a register number.
  assert.ok(!BOOKING_COLUMNS.includes('org_registration'),
    'org_registration reaches a driver surface — it is free text read by a human in admin');
});

it('no column is listed twice', () => {
  assert.equal(new Set(BOOKING_COLUMNS).size, BOOKING_COLUMNS.length);
});

// ── The lead-time mirror ─────────────────────────────────────────────────────
it('the sheet mirrors the lead-time refusals from the shared module', () => {
  assert.match(app, /import \{ startTimeRefusal, noticeFloorDay \} from '\.\/data\/bookingLeadTime'/,
    'App.jsx no longer imports the lead-time rules the endpoint uses');
  assert.match(sheet, /const leadReason = \(\(\) => \{/, 'the lead-time mirror is gone');
  assert.match(sheet, /startTimeRefusal\(\{/, 'the mirror no longer calls the shared rule');
  // And it must not re-derive the rules. A second copy is how the publish gate
  // diverged for a release.
  assert.ok(!/min_notice_hours/.test(sheet.replace(/\{\/\*[\s\S]*?\*\/\}/g, '')),
    'BookingSheet reads min_notice_hours directly — the rules belong in bookingLeadTime.js');
  assert.match(sheet, /\{!closedDay && leadReason && \(/,
    'the refusal is computed but never rendered');
});

it('the date picker floor is the notice period, and the sheet opens on it', () => {
  assert.match(app, /const openingDate = \(l, today\) =>\s*\n\s*firstOpenDate\(l, \[today, noticeFloorDay\(l\)\]\.filter\(Boolean\)\.sort\(\)\.pop\(\)\);/,
    'openingDate no longer takes the notice period into account');
  assert.match(sheet, /useState\(\(\) => openingDate\(listing, today\)\)/,
    'the sheet opens on firstOpenDate again, which can be a day its own notice period refuses');
  assert.match(sheet, /min=\{\[today, listing\.available_from, noticeFloor\]\.filter\(Boolean\)\.sort\(\)\.pop\(\)\}/,
    'the date input floor no longer includes the notice period');
});

// ── noticeFloorDay ───────────────────────────────────────────────────────────
const AT = (iso) => new Date(iso).getTime();

it('no notice requirement means no floor at all', () => {
  // Returning today would make every caller compare against a date it did not
  // need; null lets them skip it.
  for (const l of [null, {}, { min_notice_hours: 0 }, { min_notice_hours: -5 },
                   { min_notice_hours: 'x' }]) {
    assert.equal(noticeFloorDay(l, AT('2026-10-08T12:00:00Z')), null,
      `${JSON.stringify(l)} produced a floor`);
  }
});

it('24 hours on a Thursday afternoon floors at the Friday', () => {
  assert.equal(noticeFloorDay({ min_notice_hours: 24 }, AT('2026-10-08T12:00:00Z')), '2026-10-09');
  assert.equal(noticeFloorDay({ min_notice_hours: 48 }, AT('2026-10-08T12:00:00Z')), '2026-10-10');
});

it('the floor is a Belfast day, not a UTC one', () => {
  // 23:30 UTC on 8 August is 00:30 on the 9th in Belfast. Plus 24 hours is the
  // 10th there and the 9th here — so with the server's clock every notice
  // period is a day short for that hour, on the one rule that exists because
  // two drivers arrived at locked gates.
  assert.equal(noticeFloorDay({ min_notice_hours: 24 }, AT('2026-08-08T23:30:00Z')), '2026-08-10');
  // And in winter, when Belfast IS UTC, the same instant is the 9th.
  assert.equal(noticeFloorDay({ min_notice_hours: 24 }, AT('2026-12-08T23:30:00Z')), '2026-12-09');
});

it('the ceiling in noticeMs applies to the floor too', () => {
  // MAX_NOTICE_HOURS is 336 (two weeks). A malformed 100000 must not push the
  // floor eleven years out and take the listing off sale.
  const floor = noticeFloorDay({ min_notice_hours: 100000 }, AT('2026-10-08T12:00:00Z'));
  assert.equal(floor, '2026-10-22', `a 336-hour ceiling should land on 22 October, got ${floor}`);
  assert.equal(noticeMs({ min_notice_hours: 100000 }), 336 * 3600000);
});

// ── operatorFacts: credibility we can actually stand over ────────────────────
it('nothing claims the site is marshalled or staffed', () => {
  // THE TEMPTING LIE. The audit item said "marshalled spaces"; there is no
  // column for it, several of these sites are volunteer-run, and a driver who
  // reads "marshalled" and arrives to an empty yard was told something we
  // invented.
  const facts = operatorFacts({
    org_name: 'Michael Davitt GAC', org_type: 'club', spaces: 40,
    gate_opens_at: '08:00:00', gate_closes_at: '17:00:00', min_notice_hours: 24,
    is_verified: true, verified_org_type: 'club',
  });
  const all = facts.map(f => f.text).join(' ');
  assert.ok(!/marshal|steward|staff|attended|security|patrol|CCTV|safe/i.test(all),
    `operatorFacts claimed something no column supports: "${all}"`);
  // And neither does the source, including its JSX.
  const mod = readFileSync(new URL('../../src/data/listingFields.js', import.meta.url), 'utf8')
    .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert.ok(!/marshal|CCTV|patrol/i.test(mod), 'the module itself names an uncolumned claim');
});

it('every fact is a column, and knowing nothing renders nothing', () => {
  assert.deepEqual(operatorFacts(null), []);
  assert.deepEqual(operatorFacts({}), []);
  // A one-space driveway: "1 space on site" reads as a warning, not a fact.
  assert.deepEqual(operatorFacts({ spaces: 1 }), []);
  assert.deepEqual(operatorFacts({ spaces: 2 }).map(f => f.k), ['spaces']);
  // Half a gate window is not a gate window.
  assert.deepEqual(operatorFacts({ gate_opens_at: '08:00:00' }), []);
  assert.deepEqual(operatorFacts({ gate_closes_at: '17:00:00' }), []);
});

it('the operator line names the organisation and its kind', () => {
  assert.equal(operatorFacts({ org_name: 'Grosvenor Grammar', org_type: 'school' })[0].text,
    'Run by Grosvenor Grammar, a local school');
  // An unknown org_type must not render "a local undefined".
  assert.equal(operatorFacts({ org_name: 'Someone', org_type: 'syndicate' })[0].text,
    'Run by Someone');
  assert.equal(operatorFacts({ org_name: '   ' }).length, 0, 'a blank org_name produced a line');
});

it('the notice period reads in days where it divides into days', () => {
  const t = (h) => (operatorFacts({ min_notice_hours: h })[0] || {}).text;
  assert.equal(t(24), 'Book 1 day ahead');
  assert.equal(t(48), 'Book 2 days ahead');
  assert.equal(t(6), 'Book 6 hours ahead');
  assert.equal(t(1), 'Book 1 hour ahead');
  assert.equal(t(36), 'Book 36 hours ahead');   // not "1.5 days"
  assert.equal(t(0), undefined);
});

it('one rating does not define a host', () => {
  // TrustRow's rule, kept: 3+ ratings or nothing. A single five star from a
  // friend is the easiest number on this page to manufacture.
  const has = (l) => operatorFacts(l).some(f => f.k === 'rating');
  assert.ok(!has({ ratings_count: 1, average_rating: 5 }));
  assert.ok(!has({ ratings_count: 2, average_rating: 5 }));
  assert.ok(has({ ratings_count: 3, average_rating: 4.5 }));
  // And a count without a score, or a zero score, says nothing.
  assert.ok(!has({ ratings_count: 9, average_rating: 0 }));
  assert.ok(!has({ ratings_count: 9 }));
  assert.equal(operatorFacts({ ratings_count: 3, average_rating: 4.5 })[0].text,
    '4.5 out of 5 from 3 ratings');
});

it('the completed-bookings line is omitted at zero, not shown as a zero', () => {
  assert.ok(!operatorFacts({ completed_bookings_count: 0 }).length);
  assert.equal(operatorFacts({ completed_bookings_count: 1 })[0].text, '1 booking completed here');
  assert.equal(operatorFacts({ completed_bookings_count: 2 })[0].text, '2 bookings completed here');
});

it('the facts are ordered operator first and ratings last', () => {
  // Who runs it is the fact a driver cannot get anywhere else; a rating is the
  // one we have least of.
  const ks = operatorFacts({
    org_name: 'A Club', org_type: 'club', spaces: 40,
    gate_opens_at: '08:00:00', gate_closes_at: '17:00:00', min_notice_hours: 24,
    is_verified: true, ratings_count: 3, average_rating: 4.0,
    completed_bookings_count: 2,
  }).map(f => f.k);
  assert.deepEqual(ks, ['operator', 'spaces', 'gates', 'notice', 'verified', 'rating', 'completed']);
  assert.equal(new Set(ks).size, ks.length, 'a fact was listed twice');
});

it('the sheet renders the facts, keyed, above the fields', () => {
  assert.match(sheet, /const facts = operatorFacts\(listing\);/,
    'BookingSheet no longer shows who runs the site');
  assert.match(sheet, /if \(!facts\.length\) return null;/,
    'an empty fact list renders an empty box rather than nothing');
  // Above the date field: this is what somebody weighs before committing.
  const iFacts = sheet.indexOf('operatorFacts(listing)');
  const iDate = sheet.indexOf('<input type="date"');
  assert.ok(iFacts !== -1 && iDate !== -1 && iFacts < iDate,
    'the operator facts render below the date picker');
});

// ── The docs ─────────────────────────────────────────────────────────────────
it('docs/booking-path.md names the three mirrors and the excluded columns', () => {
  const docs = readFileSync(new URL('../../docs/booking-path.md', import.meta.url), 'utf8');
  for (const m of ['closedReason', 'spanReason', 'leadReason']) {
    assert.ok(docs.includes(m), `docs/booking-path.md does not document ${m}`);
  }
  assert.match(docs, /bookingLeadTime\.js/, 'the shared module is undocumented');
  // The security line is the half most likely to be widened by accident, so
  // the reason it exists has to be written down next to the list.
  for (const c of ['access_method', 'access_contact_phone', 'org_registration']) {
    assert.ok(docs.includes(c), `the docs do not say why ${c} is excluded`);
  }
  assert.match(docs, /marshalled/,
    'the docs no longer record that nothing may claim the site is marshalled');
});

console.log(`\n  ${passed} checks passed\n`);
