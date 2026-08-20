// What a driver actually meets when they add a photo of a spot.
//
// The happy path is one insert. Everything worth testing is the other three:
// an iPhone HEIC the browser cannot decode, a connection that drops mid-upload,
// and a second tap on a slow network. Each has to come back as a sentence the
// person can act on rather than a raw error.
import assert from 'node:assert/strict';
import { spotKeyOf, submitSpotPhoto } from '../../src/data/spotPhotos.js';

let passed = 0;
const it = (what, fn) => fn().then(() => { passed++; console.log(`  PASS  ${what}`); });

const okDb  = () => ({ from: () => ({ insert: async () => ({ error: null }) }) });
const errDb = (message) => ({ from: () => ({ insert: async () => ({ error: { message } }) }) });
const user  = { id: 'u1', name: 'Ciaran McAuley' };
const gem   = { id: 66, name: 'LORAG kerbside' };
const listing = { id: 'rental-abc', rental: true, listingId: 'abc' };

console.log('\nspotPhotos — the key shape');
await it('a gem keys on its bare integer, like spot_occupancy', async () => {
  assert.equal(spotKeyOf(gem), '66');
});
await it('a bookable listing keys on the rental- prefix', async () => {
  assert.equal(spotKeyOf(listing), 'rental-abc');
});
await it('and a spot with no id does not produce the string "undefined"', async () => {
  assert.equal(spotKeyOf({}), '');
  assert.equal(spotKeyOf(null), '');
});

console.log('\n  what comes back when it goes wrong');
await it('no account: says so instead of failing silently', async () => {
  const r = await submitSpotPhoto({ file: {}, spot: gem, user, upload: async () => 'u', enabled: false, db: null });
  assert.equal(r.ok, false);
  assert.match(r.error, /sign in/i);
});
await it('signed out: asks them to sign in', async () => {
  const r = await submitSpotPhoto({ file: {}, spot: gem, user: null, upload: async () => 'u', db: okDb() });
  assert.equal(r.ok, false);
  assert.match(r.error, /Sign in/i);
});
await it('no file chosen: says which step is missing', async () => {
  const r = await submitSpotPhoto({ file: null, spot: gem, user, upload: async () => 'u', db: okDb() });
  assert.equal(r.ok, false);
  assert.match(r.error, /Choose a photo/i);
});
await it('an upload failure passes the ACTIONABLE message straight through', async () => {
  // uploadListingPhoto already produces the HEIC advice that names the iPhone
  // setting to change. Replacing it with a generic "upload failed" would throw
  // away the only sentence that fixes the problem.
  const heic = 'This photo is in Apple’s HEIC format… Settings → Camera → Formats → Most Compatible';
  const r = await submitSpotPhoto({
    file: {}, spot: gem, user, db: okDb(),
    upload: async () => { throw new Error(heic); },
  });
  assert.equal(r.ok, false);
  assert.equal(r.error, heic);
});
await it('a second tap is explained, not reported as a crash', async () => {
  const r = await submitSpotPhoto({
    file: {}, spot: gem, user, upload: async () => 'u',
    db: errDb('duplicate key value violates unique constraint "spot_photos_one_pending_per_person"'),
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /already sent a photo/i);
  assert.doesNotMatch(r.error, /constraint|duplicate key/i);
});
await it('any other database error stays vague rather than leaking internals', async () => {
  const r = await submitSpotPhoto({
    file: {}, spot: gem, user, upload: async () => 'u',
    db: errDb('permission denied for relation spot_photos'),
  });
  assert.equal(r.ok, false);
  assert.doesNotMatch(r.error, /permission denied|relation/i);
});

console.log('\n  what gets stored');
await it('credits a first name, never the whole account', async () => {
  let row;
  await submitSpotPhoto({
    file: {}, spot: gem, user: { id: 'u1', name: 'Ciaran Michael McAuley' },
    upload: async () => 'https://x/y.jpg',
    db: { from: () => ({ insert: async (r) => { row = r; return { error: null }; } }) },
  });
  assert.equal(row.submitter_name, 'Ciaran Michael');
  assert.equal(row.spot_key, '66');
  assert.equal(row.photo_url, 'https://x/y.jpg');
});
await it('a caption is trimmed and capped, and an empty one is null not ""', async () => {
  let row;
  await submitSpotPhoto({
    file: {}, spot: gem, user, caption: '   ', upload: async () => 'u',
    db: { from: () => ({ insert: async (r) => { row = r; return { error: null }; } }) },
  });
  assert.equal(row.caption, null);

  await submitSpotPhoto({
    file: {}, spot: gem, user, caption: 'x'.repeat(400), upload: async () => 'u',
    db: { from: () => ({ insert: async (r) => { row = r; return { error: null }; } }) },
  });
  assert.equal(row.caption.length, 140);
});
await it('the storage path is namespaced by spot, so two photos cannot collide', async () => {
  const slots = [];
  await submitSpotPhoto({
    file: {}, spot: gem, user, db: okDb(),
    upload: async (_f, _uid, slot) => { slots.push(slot); return 'u'; },
  });
  await submitSpotPhoto({
    file: {}, spot: listing, user, db: okDb(),
    upload: async (_f, _uid, slot) => { slots.push(slot); return 'u'; },
  });
  assert.deepEqual(slots, ['spot-66', 'spot-rental-abc']);
});

console.log(`\n${passed} checks passed\n`);
