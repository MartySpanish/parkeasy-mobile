// Who is Premium: the app and the database used to disagree, silently.
//
// THE BUG, as reported with a screenshot. The owner's phone showed the header
// badge "★ Premium ✓" and, underneath it, three cards titled "Hidden gem" with
// only an area name. Not locked cards — UNLOCKED cards, with the price, the
// save button and the availability bar, over data that had none of the gem in
// it.
//
// Both halves were working as written:
//
//   THE DATABASE said no. public.has_premium() looks for a promo_redemptions
//   row with a future expires_at. There was none for that account, so the RLS
//   policy on public.hidden_gems returned zero rows and src/data/hiddenGems.js
//   fell back to hidden_gems_teaser — where every row is
//   `name: t.name || 'Hidden gem'` with a pin snapped to a ~500m grid.
//
//   THE APP said yes. isPremium came from localStorage alone:
//     ls.get('pe_premium', false) || ls.get('pe_premium_until', 0) > Date.now()
//   `pe_premium` is a boolean with NO EXPIRY, written in five places including
//   straight from `?premium=success` in the URL, and nothing anywhere ever set
//   it false.
//
// So the flag said unlock, the data said teaser, and ListCard believed the
// flag.
//
// IT COSTS MONEY IN THE OTHER DIRECTION TOO. On the live database when this
// was written: 11 live entitlements, 9 linked by user_id, and 2 with no
// user_id and no auth user holding that email — two people paying for gems the
// database cannot hand them.
//
// WHAT THESE CHECKS PIN:
//   1. The server decides, in BOTH directions. A "no" has to mean no, which is
//      the half that never existed.
//   2. An unreachable server is not a "no" — nobody is demoted by a failed
//      request on a train.
//   3. A just-paid buyer is not demoted in the seconds before the webhook.
//   4. Teaser data renders LOCKED whatever the flag says, so the screenshot is
//      structurally impossible rather than merely unlikely.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PREMIUM_GRACE_MS, LOCAL_KEYS, cachedPremium, withinGrace, resolvePremium,
  isTeaserRow, fetchPremium,
} from '../../src/data/entitlement.js';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const app = read('../../src/App.jsx');
const appCode = app
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };
const ita = async (what, fn) => { await fn(); passed++; console.log(`  PASS  ${what}`); };

console.log('\nentitlement — the app and the database stopped disagreeing');

const NOW = 1_800_000_000_000;
/** A localStorage stand-in. */
const store = (obj) => (k, fallback) => (k in obj ? obj[k] : fallback);

// ── 1. The server decides, both ways ─────────────────────────────────────────
it('the server saying NO means no, even with the old flag still set', () => {
  // THE DEFECT, in one assertion. This is the exact state of the phone in the
  // screenshot: the stale boolean on, the database saying no.
  const cached = cachedPremium(store({ [LOCAL_KEYS.flag]: true }), NOW);
  assert.equal(cached, true, 'the stale flag is not even being read — the test proves nothing');
  assert.equal(resolvePremium({ server: false, cached, nowMs: NOW }), false,
    'a database "no" lost to a localStorage boolean — this is the reported bug');
});

it('the server saying YES is enough on its own', () => {
  // A fresh device, a new browser, cleared storage: the subscription is real
  // and nothing local knows it yet.
  assert.equal(resolvePremium({ server: true, cached: false, nowMs: NOW }), true);
});

it('an unreachable server is not a "no"', () => {
  // A paying driver in a car park with no signal must not be demoted by a
  // failed request. null is "could not ask", which is not an answer.
  for (const server of [null, undefined]) {
    assert.equal(resolvePremium({ server, cached: true, nowMs: NOW }), true,
      'a failed request demoted a subscriber');
    assert.equal(resolvePremium({ server, cached: false, nowMs: NOW }), false,
      'a failed request promoted a non-subscriber');
  }
});

// ── 2. The cache is a cache ──────────────────────────────────────────────────
it('the cache reads both the lifetime flag and the dated grant', () => {
  assert.equal(cachedPremium(store({}), NOW), false);
  assert.equal(cachedPremium(store({ [LOCAL_KEYS.flag]: true }), NOW), true);
  assert.equal(cachedPremium(store({ [LOCAL_KEYS.until]: NOW + 1000 }), NOW), true);
  assert.equal(cachedPremium(store({ [LOCAL_KEYS.until]: NOW - 1000 }), NOW), false,
    'an expired dated grant still read as Premium');
  // Only `true` counts, not anything truthy — a stray string in storage from
  // an older build must not grant the paid product.
  for (const junk of ['yes', 1, 'true', {}]) {
    assert.equal(cachedPremium(store({ [LOCAL_KEYS.flag]: junk }), NOW), false,
      `${JSON.stringify(junk)} in storage was treated as Premium`);
  }
});

// ── 3. The grace window ──────────────────────────────────────────────────────
it('a buyer is not demoted in the seconds before the webhook lands', () => {
  // Stripe returns to /?premium=success and the row is written moments later.
  // In between, the server honestly says false. Without this the buyer watches
  // Premium switch off right after paying.
  assert.equal(resolvePremium({ server: false, cached: false, paidAt: NOW - 5000, nowMs: NOW }), true,
    'a just-completed checkout was demoted before the webhook landed');
  assert.equal(PREMIUM_GRACE_MS, 15 * 60 * 1000, 'the grace window moved — is the webhook still that fast?');
});

it('the grace window closes on its own, and cannot be prised open', () => {
  // It is a window, not a flag. Otherwise `?premium=success` becomes the same
  // permanent latch this whole change exists to remove — and that URL is
  // typeable by anyone.
  assert.equal(resolvePremium({ server: false, cached: false, paidAt: NOW - PREMIUM_GRACE_MS - 1, nowMs: NOW }), false,
    'the grace window never closed');
  assert.equal(withinGrace(NOW - 1, NOW), true);
  assert.equal(withinGrace(NOW - PREMIUM_GRACE_MS, NOW), false, 'the boundary is inclusive the wrong way');
  // A clock set forward, or a hand-edited value, must not buy an endless one.
  assert.equal(withinGrace(NOW + PREMIUM_GRACE_MS + 1, NOW), false,
    'a future timestamp bought an unlimited window');
  // Number(null) is 0 and Number('') is 0 — finite, and in the distant past.
  // It happens to resolve false, but only by accident of the comparison, so
  // it is stated rather than relied upon.
  for (const bad of [null, undefined, '', NaN, 0, -1, 'x']) {
    assert.equal(withinGrace(bad, NOW), false, `withinGrace(${JSON.stringify(bad)}) opened the window`);
  }
});

it('a real server YES still wins over everything', () => {
  // Order matters: the grace window is only consulted on a "no".
  assert.equal(resolvePremium({ server: true, cached: false, paidAt: null, nowMs: NOW }), true);
});

// ── 4. Teaser data is locked, whatever the flag says ─────────────────────────
it('a teaser row is a locked gem and a real row is not', () => {
  assert.equal(isTeaserRow({ approximate: true }), true);
  assert.equal(isTeaserRow({ approximate: false }), false, 'a taster was locked');
  assert.equal(isTeaserRow({}), false);
  assert.equal(isTeaserRow(null), false);
  assert.equal(isTeaserRow(undefined), false);
  // Only the boolean. A truthy string would lock every real gem.
  assert.equal(isTeaserRow({ approximate: 'yes' }), false);
});

it('isGated locks a teaser BEFORE it consults anything else', () => {
  // THE LINE THAT MAKES THE SCREENSHOT IMPOSSIBLE. It has to come first: a
  // teaser row can also be spot.mine or carry a price, and either of those
  // returns false further down — which would hand back the unlocked card over
  // data that has no name and a ~500m pin.
  const gate = appCode.slice(appCode.indexOf('const isGated = (spot) => {'));
  const body = gate.slice(0, gate.indexOf('\n};'));
  assert.ok(body.includes('if (isTeaserRow(spot)) return true;'),
    'isGated no longer locks teaser rows');
  assert.ok(body.indexOf('isTeaserRow') < body.indexOf('spot.mine'),
    'the teaser check runs after another branch that can return false first');
  assert.ok(body.indexOf('isTeaserRow') < body.indexOf('spot.price'),
    'a priced teaser row would still render unlocked');
});

// ── 5. The wiring in App.jsx ─────────────────────────────────────────────────
it('the app asks the database instead of only reading localStorage', () => {
  // THE WHOLE FIX IN ONE CHECK. The old line was:
  //   useState(()=>ls.get('pe_premium', false) || ls.get('pe_premium_until', 0) > Date.now())
  // and there was no other source of truth anywhere.
  assert.ok(!/useState\(\(\)=>ls\.get\('pe_premium'/.test(appCode),
    'isPremium is initialised straight from localStorage again');
  assert.match(appCode, /fetchPremium\(supabase\)/, 'the app never calls has_premium()');
  assert.match(appCode, /setServerPremium/, 'the server answer is not stored');
  assert.match(appCode, /resolvePremium\(\{/, 'the two answers are not reconciled');
});

it('the cache is only written from a real answer, never from a null', () => {
  // Writing the fallback back into storage as though it were fact is how the
  // stale flag became permanent. A null reading must leave storage alone.
  assert.match(appCode, /if \(serverPremium === true \|\| serverPremium === false\) \{/,
    'the cache write is not gated on a real answer');
});

it('everything that can change the entitlement re-asks', () => {
  // Signing in changes WHO is being asked about; redeeming and checking out
  // change the answer. Each has to invalidate the previous reading or the app
  // keeps an answer from before the change.
  const bumps = appCode.match(/setPremiumNonce\(n => n \+ 1\)/g) || [];
  assert.ok(bumps.length >= 3,
    `only ${bumps.length} paths re-ask after an entitlement change — expected sign-in, redeem and checkout`);
  assert.match(appCode, /\}, \[user\?\.id, premiumNonce\]\);/,
    'the entitlement read does not re-run on sign-in or on a nonce bump');
});

it('a completed checkout records when, not just that', () => {
  assert.match(appCode, /ls\.set\(LOCAL_KEYS\.paid, Date\.now\(\)\)/,
    'the checkout time is not recorded — the grace window can never open');
});

// ── 6. fetchPremium never throws ─────────────────────────────────────────────
await ita('every failure reads as "could not ask", never as "no"', async () => {
  // Returning false on an error would demote a subscriber the moment the
  // network hiccupped — the exact failure mode this module exists to prevent.
  assert.equal(await fetchPremium(null), null, 'no client did not read as unknown');
  assert.equal(await fetchPremium({ rpc: async () => { throw new Error('offline'); } }), null,
    'a thrown error did not read as unknown');
  assert.equal(await fetchPremium({ rpc: async () => ({ data: null, error: { message: 'nope' } }) }), null,
    'an RPC error did not read as unknown');
  // And a real answer comes through unchanged, both ways.
  assert.equal(await fetchPremium({ rpc: async () => ({ data: true, error: null }) }), true);
  assert.equal(await fetchPremium({ rpc: async () => ({ data: false, error: null }) }), false);
  // Anything that is not literally true is not a yes.
  assert.equal(await fetchPremium({ rpc: async () => ({ data: 'true', error: null }) }), false);
});

await ita('it calls the function the RLS policy actually uses', async () => {
  // If this drifts to a different function name the client is asking a
  // question nobody answers, and resolvePremium() would see null forever.
  let asked = null;
  await fetchPremium({ rpc: async (name) => { asked = name; return { data: true, error: null }; } });
  assert.equal(asked, 'has_premium', `the client asked for ${asked}`);
  const policy = read('../../supabase/migrations/20260820_hidden_gems.sql');
  assert.match(policy, /using \(status = 'published' and public\.has_premium\(\)\)/,
    'the hidden_gems policy no longer uses has_premium() — the client is asking the wrong thing');
  assert.match(policy, /grant execute on function public\.has_premium\(\) to anon, authenticated/,
    'has_premium() is not callable by the client');
});

// ── 7. The user is told when the two still disagree ──────────────────────────
it('a Premium member served teaser data is told, not shown a broken card', () => {
  // The reason this bug survived is that the broken version looked like a
  // working screen. Reaching this state now means has_premium() said yes and
  // the rows still did not arrive, which is a fault and has to say so.
  assert.match(appCode, /isPremium && gemSource === 'teaser' &&/,
    'nothing surfaces the case where the entitlement is real but the gems did not arrive');
});

console.log(`\n  ${passed} checks passed\n`);
