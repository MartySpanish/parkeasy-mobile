// What a listing must have before it can be published, where the bar sits, and
// — the point of this file — that there is only ONE copy of the rule.
//
// The gate used to be HARDER for an organisation than for a driveway: twelve
// requirements to seven. Four photos instead of two, a legal name, an
// organisation type, a registration number, a named access contact with a
// mobile, and thirty characters of access method — put in front of a GAA club
// treasurer or a parish secretary, which is the host worth more than fifty
// driveways and the least likely to finish a long form on a phone.
//
// It was doing that for nothing. An organisation listing does not go live when
// it is published: it goes to `pending_approval` and emails the founder, who
// reads every one. The gate was demanding things BEFORE a review that exists
// to ask for exactly those things.
//
// So they moved rather than vanished: approvalChecklist() returns them for the
// queue, and both the notification email and the founder's own screen carry
// them. A residential listing keeps its full gate, because that one DOES go
// live immediately and the gate is the only thing in front of it.
//
// AND THEN IT DID NOTHING ANYWAY, because App.jsx held a hand-kept twin of the
// gate called checkRequirements() and nobody lowered that one. The server would
// have accepted a listing the form refused to submit; the treasurer saw no
// change at all. The rule now lives in ONE module that both import, and the
// checks below fail if a second copy ever appears.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const core = await import('../../src/data/publishGateCore.js');
const api = await import('../../api/publish-listing.js');
const { listingRequirements, approvalChecklist, minPhotosFor,
        MIN_PRICE_PER_HOUR, MIN_PRICE_PER_DAY } = core;
const apiSrc = readFileSync(new URL('../../api/publish-listing.js', import.meta.url), 'utf8');
const app = readFileSync(new URL('../../src/App.jsx', import.meta.url), 'utf8');

/** A listing with everything a driveway needs, and nothing more. */
const base = (over = {}) => ({
  photos: ['a', 'b'],
  instructions: 'Third gate on the left, blue door, space is behind the hedge.',
  lat: 54.5973, lng: -5.9301,
  price_per_day: 10,
  availability: 'evenings_weekends',
  contact_phone: '07700900000',
  spaces: 1,
  host_type: 'residential',
  ...over,
});
const club = (over = {}) => base({
  host_type: 'organization', photos: ['a'], spaces: 40,
  org_name: "St Jude's GAC", org_type: 'club', ...over,
});

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };

console.log('\npublishGate — one copy of the rule, and the club gets past it');

it('the server and the form run the very same function', () => {
  // The whole reason this file exists. Not "they agree on these fixtures" —
  // identical function objects, so they cannot drift.
  assert.equal(api.listingRequirements, core.listingRequirements,
    'api/publish-listing.js has its own copy of the gate again');
  assert.equal(api.approvalChecklist, core.approvalChecklist,
    'api/publish-listing.js has its own copy of the approval checklist again');
  assert.match(app, /from '\.\/data\/publishGateCore'/,
    'App.jsx no longer imports the shared gate');
  assert.match(app, /listingRequirements as checkRequirements/,
    'App.jsx is not using the shared gate under its old local name');
  // And no local definition of it, under either name.
  assert.doesNotMatch(app, /const checkRequirements\s*=\s*\(/,
    'App.jsx has grown a second copy of the gate — the last change to the rule silently did nothing for exactly this reason');
  assert.doesNotMatch(app, /const listingRequirements\s*=\s*\(/,
    'App.jsx has grown a second copy of the gate under the real name');
  // The thresholds themselves must not be re-typed in the UI either.
  assert.doesNotMatch(app, /host_type\s*===\s*'organization'\s*\?\s*4\s*:\s*2/,
    'the old four-photo organisation bar has been re-hardcoded in App.jsx');
  assert.doesNotMatch(app, /const MIN_PRICE_PER_(HOUR|DAY)\s*=/,
    'App.jsx defines its own price floor again');
});

it('a club with the basics can publish', () => {
  // One photo, no registration number, no access contact, no access write-up.
  assert.deepEqual(listingRequirements(club()), [],
    'an organisation is still blocked on things the founder reviews anyway');
  assert.equal(minPhotosFor({ host_type: 'organization' }), 1);
  assert.equal(minPhotosFor({ host_type: 'residential' }), 2);
  // Only the exact string 'organization' earns the lower bar. Anything else —
  // null, missing, a typo, a host type added later — goes live unreviewed, so
  // it gets the higher one. Guessing the other way sells one photo of a
  // driveway to a driver with nobody having looked.
  assert.equal(minPhotosFor(null), 2, 'a null listing gets the lower bar');
  assert.equal(minPhotosFor({}), 2, 'a listing with no host type at all gets the lower bar');
  assert.equal(minPhotosFor({ host_type: 'Organization' }), 2, 'the host type is matched case-insensitively, so a stray capital lowers the bar');
  assert.equal(minPhotosFor({ host_type: 'operator' }), 2, 'a host type nobody has written a review step for gets the lower bar');
});

it('a club still cannot publish anonymously', () => {
  // Who they are is the one thing the founder cannot work out from the
  // listing, and it separates a club car park from somebody letting a field
  // they do not own.
  assert.ok(listingRequirements(club({ org_name: '' })).some(m => /legal name/i.test(m)),
    'a listing with no organisation name publishes');
  assert.ok(listingRequirements(club({ org_type: null })).some(m => /Organization type/i.test(m)),
    'a listing with no organisation type publishes');
});

it('the driveway gate is unchanged, and is stricter than the club one', () => {
  assert.deepEqual(listingRequirements(base()), [], 'a complete driveway is blocked');
  // The asymmetry, asserted directly: residential goes live unreviewed, so it
  // keeps the higher bar. If this ever flips, the reasoning has been lost.
  assert.ok(listingRequirements(base({ photos: ['a'] })).some(m => /photo/i.test(m)),
    'a driveway now publishes on one photo, with nobody reviewing it');
  assert.deepEqual(listingRequirements(club({ photos: ['a'] })), [],
    'an organisation is held to the driveway photo bar again');
  assert.ok(listingRequirements(base({ instructions: 'round the back' })).some(m => /How to find it/i.test(m)),
    'a driveway publishes with no usable directions');
});

it('the price floors are now enforced where it counts, not only in the form', () => {
  // These lived in App.jsx alone, so /api/publish-listing would happily
  // publish a 50p-an-hour space to anyone who skipped the UI. Moving the gate
  // into one module is what closed that.
  assert.ok(MIN_PRICE_PER_HOUR > 0 && MIN_PRICE_PER_DAY > MIN_PRICE_PER_HOUR,
    'the floors are gone or a day now costs less than an hour');
  // Pinned at the boundary, not by wording: a penny under is refused, the floor
  // itself is accepted. Catches the check being dropped, the comparison being
  // loosened, and the floor quietly moving.
  assert.ok(listingRequirements(base({ price_per_hour: MIN_PRICE_PER_HOUR - 0.01, price_per_day: null })).length > 0,
    'an underpriced hourly rate publishes');
  assert.deepEqual(listingRequirements(base({ price_per_hour: MIN_PRICE_PER_HOUR, price_per_day: null })), [],
    'the hourly floor refuses the floor itself');
  assert.ok(listingRequirements(base({ price_per_day: MIN_PRICE_PER_DAY - 0.01 })).length > 0,
    'an underpriced day rate publishes');
  assert.deepEqual(listingRequirements(base({ price_per_day: MIN_PRICE_PER_DAY })), [],
    'the day floor refuses the floor itself');
  // A sound hourly rate must not excuse a mistyped day rate on the same listing,
  // and "equal" is not "higher".
  // ABOVE BOTH FLOORS on purpose. A £3/hr–£2/day pair looks like it tests this
  // rule and does not: £2 is already under the £5 day floor, so the day floor
  // catches it and the comparison could be deleted unnoticed. Only a pair that
  // clears both floors can prove the day-vs-hour rule is doing anything.
  assert.ok(listingRequirements(base({ price_per_hour: 20, price_per_day: 15 })).length > 0,
    'a day rate cheaper than an hour publishes');
  assert.ok(listingRequirements(base({ price_per_hour: 20, price_per_day: 20 })).length > 0,
    'a day rate equal to the hourly rate publishes as an all-day deal that is not one');
  assert.deepEqual(listingRequirements(base({ price_per_hour: 3, price_per_day: 20 })), [],
    'a listing carrying both sound rates is blocked');
});

it('what stopped blocking is now owed at approval, not forgotten', () => {
  const owed = approvalChecklist(club());
  assert.ok(owed.some(m => /photo/i.test(m)), 'the photo bar is gone entirely');
  assert.ok(owed.some(m => /Registration number/i.test(m)), 'the registration number is gone entirely');
  assert.ok(owed.some(m => /access contact/i.test(m)), 'the access contact is gone entirely');
  assert.ok(owed.some(m => /access method/i.test(m)), 'the access method is gone entirely');
  // A club that filled everything in owes nothing.
  assert.deepEqual(approvalChecklist(club({
    photos: ['a', 'b', 'c', 'd'], org_registration: 'NIC101010',
    access_contact_name: 'Sean', access_contact_phone: '07700900111',
    access_method: 'Barrier is raised from 6pm; code 1978 on the keypad by the gate.',
  })), [], 'a complete organisation listing is still nagged');
  // And a driveway has no approval step, so it owes nothing here ever.
  assert.deepEqual(approvalChecklist(base()), [],
    'a residential listing is being given an organisation checklist');
});

it('an organisation listing does not go live on publish', () => {
  // The entire justification for the softer gate. If this ever changes, the
  // gate must go back up — the comment says so and this makes it fail loudly.
  assert.match(apiSrc, /pending_approval/, 'the approval queue is gone');
  assert.match(apiSrc, /isOrg && !l\.approved_by_founder\s*\?\s*\{ status: 'pending_approval' \}/,
    'an organisation listing now publishes straight to active, with the lowered gate in front of nothing');
});

it('the founder is told what is still owed, in the email and on the screen', () => {
  assert.match(apiSrc, /const owed = approvalChecklist\(l\)/, 'the checklist is never computed');
  assert.match(apiSrc, /Still to ask them for/, 'the approval email does not carry the checklist');
  // Host-controlled text reaches an HTML email, so it is escaped.
  assert.match(apiSrc, /esc\(l\.org_name \|\| l\.title\)/, 'the organisation name is interpolated raw');
  assert.match(apiSrc, /esc\(l\.address\)/, 'the address is interpolated raw');
  assert.match(apiSrc, /owed\.map\(x => `<li>\$\{esc\(x\)\}<\/li>`\)/, 'checklist items are interpolated raw');
  assert.match(apiSrc, /const esc = \(v\) =>/, 'the escaper itself is gone, so every interpolation above is raw');
  // The approval screen, which is where the asking actually happens.
  assert.match(app, /approvalChecklist\(l\)\.length > 0 &&/,
    'the founder\'s approval queue does not show what is still owed');
  assert.match(app, /Still to ask them for/, 'the approval screen has no checklist heading');
  // It printed "Access: null (null) — null" the moment those fields became
  // optional, which is how a relaxed gate turns into a broken admin page.
  assert.match(app, /l\.access_contact_name \|\| l\.access_method \?/,
    'the approval screen prints an access line for a club that gave no access details');
});

it('the form itself stopped demanding what the gate stopped demanding', () => {
  // A gate nobody can reach is not a lowered gate. These three fields kept
  // their asterisk and their required-looking labels after the server relaxed.
  assert.doesNotMatch(app, /Registration number \*/, 'the form still marks the registration number required');
  assert.doesNotMatch(app, /Access contact on the day \*/, 'the form still marks the access contact required');
  assert.doesNotMatch(app, /Access method \*/, 'the form still marks the access method required');
  assert.match(app, /Helpful, but not needed to submit/,
    'nothing tells the host those fields are optional, so they read as required anyway');
  // And the photo step counted TILES, so a club needed all four prompt slots
  // filled before the form would call the photo step done.
  assert.match(app, /const photosDone = photos\.length >= minPhotos;/,
    'the photo step is measured against the number of prompt tiles again, not the real minimum');
  assert.doesNotMatch(app, /photos\.length >= requiredSlots\.length/,
    'the four organisation prompt slots are all required again');
  assert.match(app, /\(min \{minPhotos\}, max 10\)/, 'the form states a photo minimum it does not use');
});

console.log(`\n  ${passed} checks passed\n`);
