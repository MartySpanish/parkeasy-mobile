// The Google basemap diagnostic, and the one thing it must never do.
//
// WHY THE ENDPOINT EXISTS. src/mapTiles.js's Google path is complete: all five
// map surfaces go through BaseTileLayer, the createSession request shape was
// checked against the live endpoint, and tile.googleapis.com is in both
// img-src and connect-src. So when the map falls back to OpenStreetMap the
// cause is the state of the Google Cloud project, and there are three of those
// that look identical from outside — API not enabled, no billing, or a
// referrer restriction. Telling them apart used to mean reading a console.warn
// on a phone.
//
// WHY THESE CHECKS. The endpoint reads a live credential and talks to Google,
// so the failure that matters is not "it gave the wrong advice", it is "it put
// the key in an HTTP response". Google echoes request URLs in some error
// messages, so that is a real path and not a hypothetical one. Everything else
// here is about the advice being right, because advice that names the wrong
// one of the three costs somebody an hour in the wrong console page.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scrub, diagnose, checkMapTiles, checkStreetView } from '../../api/mapcheck.js';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const src = read('../../api/mapcheck.js');

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };
const ita = async (what, fn) => { await fn(); passed++; console.log(`  PASS  ${what}`); };

console.log('\nmapcheck — tell the three Google failures apart, and never echo the key');

const KEY = 'AIzaSyFAKE-not-a-real-key-000000000000000';

const json = (status, body) => async () => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(body),
  json: async () => body,
});

// ── 1. The key must never come back ──────────────────────────────────────────
it('the key is scrubbed out of anything Google says', () => {
  // THE FAILURE THAT MATTERS. Google's error messages sometimes quote the
  // request, and the request carries ?key=... — so a verbatim passthrough
  // publishes the credential to any caller.
  const leaked = `Requests to this API tile.googleapis.com are blocked. Request: ?key=${KEY}&x=1`;
  const out = scrub(leaked, KEY);
  assert.ok(!out.includes(KEY), `the raw key survived scrubbing: ${out}`);
  assert.ok(out.includes('[key]'), 'the key was removed but not marked');

  // URL-encoded too, which is the form it actually travels in.
  const enc = `denied for key=${encodeURIComponent(KEY)}`;
  assert.ok(!scrub(enc, KEY).includes(KEY), 'the URL-encoded key survived');

  // And any OTHER Google-shaped key, in case an error names a different one
  // from the same account.
  const other = 'AIzaSyDIFFERENT-key-111111111111111111111';
  assert.ok(!scrub(`blocked: ${other}`, KEY).includes(other),
    'a second key in the message was passed through');
});

it('scrubbing survives junk input and is bounded', () => {
  for (const v of [null, undefined, '', 0, NaN, {}]) {
    assert.equal(typeof scrub(v, KEY), 'string', `scrub(${JSON.stringify(v)}) did not return a string`);
  }
  // No key to scrub must not throw, and must not corrupt the message.
  assert.equal(scrub('plain message', ''), 'plain message');
  assert.equal(scrub('plain message', null), 'plain message');
  // Bounded, so a hostile upstream cannot make the response enormous.
  assert.ok(scrub('x'.repeat(5000), KEY).length <= 400, 'the message is not length-capped');
});

await ita('no response field can carry the key, on success or failure', async () => {
  // The whole object, not just the message: a success path returning the
  // session token would be just as bad, because that token authorises billed
  // tile requests on its own.
  const ok = await checkMapTiles(KEY, json(200, { session: 'SECRET-SESSION-TOKEN', expiry: '1800000000' }));
  const okText = JSON.stringify(ok);
  assert.ok(!okText.includes(KEY), 'the key came back on the success path');
  assert.ok(!okText.includes('SECRET-SESSION-TOKEN'),
    'the session token was returned — it is a bearer credential for billed tiles');
  assert.equal(ok.sessionReceived, true, 'a successful session was not reported');
  assert.equal(ok.ok, true);

  const bad = await checkMapTiles(KEY, json(403, {
    error: { code: 403, message: `Requests blocked. key=${KEY}`, status: 'PERMISSION_DENIED' },
  }));
  assert.ok(!JSON.stringify(bad).includes(KEY), 'the key came back on the failure path');

  const sv = await checkStreetView(KEY, json(200, { status: 'REQUEST_DENIED', error_message: `bad key ${KEY}` }));
  assert.ok(!JSON.stringify(sv).includes(KEY), 'the key came back from the Street View check');
});

// ── 2. The advice names the right one of the three ───────────────────────────
it('an unenabled API is not reported as a billing problem', () => {
  // These two are the pair most often confused, and they are in different
  // console pages. Naming the wrong one costs an hour.
  const disabled = diagnose(403, { error: { message:
    'Map Tiles API has not been used in project 123 before or it is disabled.',
    details: [{ reason: 'SERVICE_DISABLED' }] } });
  assert.match(disabled, /NOT ENABLED/, `a disabled API was diagnosed as: ${disabled}`);
  assert.ok(!/billing/i.test(disabled), 'a disabled API was blamed on billing');

  const billing = diagnose(403, { error: { message:
    'This API method requires billing to be enabled.',
    details: [{ reason: 'BILLING_DISABLED' }] } });
  assert.match(billing, /billing/i, `a billing failure was diagnosed as: ${billing}`);
  assert.ok(!/NOT ENABLED/.test(billing), 'a billing failure was blamed on the API toggle');
});

it('an invalid key is called an invalid key', () => {
  // This is the exact body the live endpoint returns for a bad key — checked
  // against tile.googleapis.com directly.
  const d = diagnose(400, { error: {
    code: 400, message: 'API key not valid. Please pass a valid API key.',
    status: 'INVALID_ARGUMENT',
    details: [{ reason: 'API_KEY_INVALID' }] } });
  assert.match(d, /not valid/i, `an invalid key was diagnosed as: ${d}`);
  assert.match(d, /VITE_GOOGLE_MAPS_KEY/, 'it does not say where to look');
});

it('a referrer block is now a settled answer, because the probe declares one', () => {
  // THE FIRST VERSION OF THIS ENDPOINT COULD NOT ANSWER ITS OWN QUESTION. It
  // called with no Referer, Google replied "Requests from referer <empty> are
  // blocked", and the diagnosis had to hedge: true, but about a question
  // nobody asked. Of course a server with no referrer trips a referrer
  // restriction. It said nothing about the browser, which is the only thing
  // anyone wants to know.
  //
  // The probe now sends the referrer a real visitor's browser sends, so a
  // refusal IS the answer for the live site and the hedge would be a lie.
  const d = diagnose(403, { error: { message: 'Requests from referer <empty> are blocked.',
    details: [{ reason: 'API_KEY_HTTP_REFERRER_BLOCKED' }] } });
  assert.match(d, /referrer restriction/i);
  assert.ok(!/does not prove/i.test(d),
    'the diagnosis still hedges, but the probe now declares parkeasy.uk — the hedge is no longer true');
  assert.match(d, /parkeasy\.uk/, 'it does not say which domain to allow');
  assert.match(d, /vercel\.app/, 'it does not mention preview domains');
});

await ita('the probe sends the referrer a browser would, and reports both attempts', async () => {
  // Without this the endpoint is only capable of telling you that servers
  // cannot use a referrer-restricted key, which nobody needed to know.
  const seen = [];
  const fake = async (_url, opts) => {
    seen.push(opts?.headers?.Referer || null);
    return { ok: true, status: 200, text: async () => JSON.stringify({ session: 'T', expiry: '1800000000' }),
      json: async () => ({ session: 'T', expiry: '1800000000' }) };
  };
  const out = await checkMapTiles(KEY, fake);
  assert.ok(seen.includes('https://parkeasy.uk/'),
    `no attempt declared the site referrer: ${JSON.stringify(seen)}`);
  assert.ok(seen.includes(null), 'the bare-server attempt is gone — the comparison is what separates the cases');
  // And the verdict is taken from the REFERRED attempt, not the bare one.
  assert.equal(out.ok, true);
  assert.match(out.diagnosis, /referrer/i, 'the success verdict does not say which attempt succeeded');
  assert.ok(out.asServer, 'the bare-server result is not reported alongside');
});

it('a working session says so, and names the stale-token case', () => {
  // The case that bit this project: tiles kept coming from a cached token
  // after the API behind it was switched off, then stopped when it expired.
  // If Google says yes and the app still shows OSM, that is where to look.
  const src2 = src;
  assert.match(src2, /parkeasy\.googleTileSession\.v1/,
    'the success path does not name the cached-token key to clear');
});

// ── 3. No key configured is its own answer ───────────────────────────────────
await ita('a missing key is distinguished from a refused one', async () => {
  // "Not configured" and "configured but refused" need different actions, and
  // reporting the first as the second sends somebody to the Google console
  // when the fix is in Vercel.
  const none = await checkMapTiles('', json(200, {}));
  assert.equal(none.ok, false);
  assert.equal(none.configured, false, 'a missing key was reported as configured');
  assert.match(none.diagnosis, /not set/i);
  assert.match(none.diagnosis, /Vercel/, 'it does not say where to set it');

  const refused = await checkMapTiles(KEY, json(403, { error: { message: 'nope', details: [{ reason: 'SERVICE_DISABLED' }] } }));
  assert.equal(refused.configured, true, 'a configured-but-refused key was reported as missing');
});

await ita('a network failure is not reported as a Google refusal', async () => {
  const thrown = await checkMapTiles(KEY, async () => { throw new Error('ECONNRESET'); });
  assert.equal(thrown.ok, false);
  assert.match(thrown.diagnosis, /failed before it got an answer/i);
  const svThrown = await checkStreetView(KEY, async () => { throw new Error('ECONNRESET'); });
  assert.equal(svThrown.ok, false);
});

// ── 4. Street View is a separate product with a separate toggle ──────────────
await ita('Street View OK and REQUEST_DENIED are told apart, and say so', async () => {
  const ok = await checkStreetView(KEY, json(200, { status: 'OK' }));
  assert.equal(ok.ok, true);
  assert.match(ok.diagnosis, /working/i);

  const denied = await checkStreetView(KEY, json(200, { status: 'REQUEST_DENIED' }));
  assert.equal(denied.ok, false);
  assert.match(denied.diagnosis, /separate from Map Tiles/i,
    'it does not say this is a different toggle from the basemap');

  // ZERO_RESULTS at Belfast City Hall is not a coverage answer — it has
  // coverage — so it must not be reported as "no panorama here".
  const zero = await checkStreetView(KEY, json(200, { status: 'ZERO_RESULTS' }));
  assert.equal(zero.ok, false);
  assert.match(zero.diagnosis, /key or project problem/i);
});

// ── 5. The endpoint itself ───────────────────────────────────────────────────
it('it is read-only, uncacheable by robots, and changes nothing', () => {
  assert.match(src, /req\.method !== 'GET'/, 'the handler accepts more than GET');
  assert.match(src, /X-Robots-Tag', 'noindex'/, 'the diagnostic is indexable');
  assert.match(src, /s-maxage=300/, 'each call mints a session with no edge cache');
  // It must never be a write path: no Supabase, no service key, no mutation.
  assert.ok(!/SERVICE_ROLE|supabase|STRIPE/i.test(src),
    'the diagnostic reaches for credentials it has no business holding');
  // And it reports presence of the key, never the key.
  assert.match(src, /keyConfigured: Boolean\(key\)/, 'the key presence flag is gone');
  assert.ok(!/key,\s*$/m.test(src.split('return res.status(200).json(')[1] || ''),
    'the response object appears to include the key itself');
});

console.log(`\n  ${passed} checks passed\n`);
