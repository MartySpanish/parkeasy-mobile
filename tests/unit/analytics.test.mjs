// The client half of app_events, and the one way it silently breaks.
//
// track() names an event; log_app_event() in the database decides whether that
// name is allowed. Neither knows about the other, so a name added to one and
// not the other fails in the quietest possible way: the call succeeds, the
// function returns false, nothing is stored, and the dashboard shows a flat
// line for a feature that is working perfectly. Nothing else in the suite
// would catch that, which is why the first check here compares the two lists
// character by character.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const client = read('../../src/analytics.js');
const migration = read('../../supabase/migrations/20260902_app_events_ingest.sql');
const app = read('../../src/App.jsx');

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };

const names = (src, start, end) => {
  const block = src.slice(src.indexOf(start) + start.length, src.indexOf(end, src.indexOf(start)));
  return [...block.matchAll(/'([a-z_]+)'/g)].map(m => m[1]).sort();
};

console.log('\nanalytics — the client and the database agree');

it('the allowlists match exactly', () => {
  const clientNames = names(client, 'const KNOWN = new Set([', ']);');
  const dbNames = names(migration, 'allowed constant text[] := array[', '];');
  assert.ok(clientNames.length >= 20, `only ${clientNames.length} names in the client list`);
  assert.deepEqual(clientNames, dbNames,
    'the client and the database disagree about which events exist — an event in '
    + 'only one of them is dropped on arrival with no error anywhere');
});

it('every event the app fires is on the list', () => {
  const clientNames = new Set(names(client, 'const KNOWN = new Set([', ']);'));
  const fired = new Set();
  for (const src of [app, read('../../src/partners.js')]) {
    for (const m of src.matchAll(/\btrack\(\s*'([a-z_]+)'/g)) fired.add(m[1]);
  }
  assert.ok(fired.size >= 8, `only ${fired.size} track() call sites found — the wiring may have been removed`);
  for (const name of fired) {
    assert.ok(clientNames.has(name), `App.jsx fires "${name}", which is not on the allowlist`);
  }
});

it('a metric can never break a driver\'s session', () => {
  // Every path out of track() is wrapped. An analytics call that throws into a
  // render is a crash on the screen somebody came to the app to use.
  assert.match(client, /export const track = \([^)]*\) => \{\s*try \{/,
    'track() no longer opens with a try block');
  assert.match(client, /\.then\(\(\) => \{\}, \(\) => \{\}\)/,
    'the RPC promise no longer swallows its rejection — an unhandled rejection is a console error on every failed insert');
});

it('map_move is throttled, or it eats the whole rate limit', () => {
  // 60 events a minute, and a drag fires as fast as the finger moves. Without
  // a throttle the budget is gone in seconds and every event that matters is
  // refused for the rest of the minute.
  assert.match(client, /THROTTLE_MS = \{\s*map_move:\s*(\d+)/, 'map_move is no longer throttled');
  const ms = Number(client.match(/map_move:\s*(\d+)/)[1]);
  assert.ok(ms >= 1000, `map_move throttle is ${ms}ms — too short to protect a 60/min budget`);
});

it('the session id is a real uuid, and not shared with anyone', () => {
  // session_id is typed uuid in the database; a non-uuid is rejected outright.
  assert.match(client, /UUID = \/\^\[0-9a-f\]\{8\}-/, 'the uuid check on the stored session id is gone');
  // notify.js's pe_client_key falls back to the literal 'anon', which would put
  // every private-window visitor into one rate-limit bucket. Matching on the
  // READ, not the name: the file mentions the key in a comment saying exactly
  // why it is not reused, and a check that cannot tell those apart is a check
  // that fires on its own documentation.
  assert.ok(!/getItem\(\s*'pe_client_key'/.test(client),
    'analytics reads notify.js\'s client key, whose "anon" fallback is shared by every visitor');
  assert.match(client, /const KEY = 'pe_session_id'/, 'analytics no longer keeps its own session key');
});

it('premium_paid marks purchases only', () => {
  // setIsPremium(true) is also called for the VIP list, the gem-approval reward
  // and promo codes. Counting those as premium_paid puts free grants in the
  // conversion rate that decides whether the paywall is working.
  const i = app.indexOf("track('premium_paid')");
  assert.ok(i > 0, 'premium_paid is no longer fired');
  const context = app.slice(Math.max(0, i - 400), i);
  assert.match(context, /premium'\) === 'success'/,
    'premium_paid moved away from the Stripe success return — it may now count free grants');
  assert.equal(app.split("track('premium_paid')").length - 1, 1,
    'premium_paid is fired from more than one place');
});

console.log(`\n  ${passed} checks passed\n`);
