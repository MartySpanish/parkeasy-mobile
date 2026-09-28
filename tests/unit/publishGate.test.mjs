// What a listing must have before it can be published, and where the bar sits.
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
// queue, and the notification email carries them. A residential listing keeps
// its full gate, because that one DOES go live immediately and the gate is the
// only thing in front of it. That asymmetry is the whole design, and it is
// what these checks hold in place.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { listingRequirements, approvalChecklist } = await import('../../api/publish-listing.js');
const src = readFileSync(new URL('../../api/publish-listing.js', import.meta.url), 'utf8');

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

console.log('\npublishGate — the club gets in, the driveway still does not');

it('a club with the basics can publish', () => {
  // One photo, no registration number, no access contact, no access write-up.
  assert.deepEqual(listingRequirements(club()), [],
    'an organisation is still blocked on things the founder reviews anyway');
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
  assert.match(src, /pending_approval/, 'the approval queue is gone');
  assert.match(src, /isOrg && !l\.approved_by_founder\s*\?\s*\{ status: 'pending_approval' \}/,
    'an organisation listing now publishes straight to active, with the lowered gate in front of nothing');
});

it('the founder is told what is still owed', () => {
  assert.match(src, /const owed = approvalChecklist\(l\)/, 'the checklist is never computed');
  assert.match(src, /Still to ask them for/, 'the approval email does not carry the checklist');
  // Host-controlled text reaches an HTML email, so it is escaped.
  assert.match(src, /esc\(l\.org_name \|\| l\.title\)/, 'the organisation name is interpolated raw');
  assert.match(src, /esc\(l\.address\)/, 'the address is interpolated raw');
  assert.match(src, /owed\.map\(x => `<li>\$\{esc\(x\)\}<\/li>`\)/, 'checklist items are interpolated raw');
});

console.log(`\n  ${passed} checks passed\n`);
