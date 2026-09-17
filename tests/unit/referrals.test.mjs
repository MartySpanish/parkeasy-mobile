// A referral code has to survive being read out in a car park, and a referral
// card has to survive being read by somebody who is owed nothing yet.
//
// Two failure modes, both quiet:
//
//   * a code that reads ambiguously, so the referral goes to nobody and the
//     driver who mistyped it never finds out;
//   * a card that calls unearned points "pending", which is a promise about
//     something that may never happen.
//
// And one that is not quiet at all: a referral link that arrives at somebody
// with no account, which is nearly all of them.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  normaliseCode, looksLikeCode, referralLine, claimMessage, CODE_ALPHABET, CODE_RE,
} from '../../src/data/referralsCore.js';

const cut = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
  .replace(/^\s*--.*$/gm, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/^\s*\/\*[\s\S]*?\*\//gm, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const mig    = cut('../../supabase/migrations/20260918_referrals.sql');
const app    = cut('../../src/App.jsx');
const client = cut('../../src/data/referrals.js');
const admin  = cut('../../api/admin.js');

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };

console.log('\nreferrals — a code you can read out, and a card that promises nothing');

//-------------------------------------------------------------------- the code
it('the alphabet is the one the database enforces', () => {
  // A mismatch means the app refuses a code the database would accept, or
  // accepts one it will reject — and either way the driver is told nothing
  // useful.
  const check = mig.match(/check \(code ~ '\^\[([A-Z0-9]+)\]\{6\}\$'\)/);
  assert.ok(check, 'the shape constraint is gone from the migration');
  assert.equal(check[1], CODE_ALPHABET,
    `the client uses ${CODE_ALPHABET} and the database enforces ${check[1]}`);
  // And the generator draws from the same set, with the right modulus.
  const gen = mig.match(/substr\('([A-Z0-9]+)',\s*\n?\s*1 \+ floor\(random\(\) \* (\d+)\)/);
  assert.ok(gen, 'the generator is gone');
  assert.equal(gen[1], CODE_ALPHABET, 'the generator draws from a different alphabet');
  assert.equal(Number(gen[2]), CODE_ALPHABET.length,
    `the modulus is ${gen[2]} for an alphabet of ${CODE_ALPHABET.length} — some characters can never appear`);
});

it('none of the characters people read as each other are in it', () => {
  // One of each pair, not both: I/1, L/1, O/0, S/5.
  for (const c of ['I', 'L', 'O', 'S', '0', '1', '5']) {
    assert.ok(!CODE_ALPHABET.includes(c), `"${c}" is in the alphabet`);
  }
  // The range '[A-HJ-NP-Z2-9]' looks careful and quietly includes L and S. It
  // was the first version of this, and the database test caught it.
  assert.ok(!/\[A-HJ-NP-Z2-9\]/.test(mig.replace(/^\s*--.*$/gm, '')),
    'a character range is back in the executable part of the migration');
  assert.equal(CODE_ALPHABET.length, 29);
});

it('a code is read the way a person types it', () => {
  assert.equal(normaliseCode('pq4r7t'), 'PQ4R7T');
  assert.equal(normaliseCode('  PQ4R7T  '), 'PQ4R7T');
  assert.equal(normaliseCode('ABCDEF'), 'ABCDEF');
  // A genuinely wrong character is a dead end reported as invalid, not a
  // silently different code that goes to a stranger.
  assert.equal(normaliseCode('ABC0IL'), null);
  assert.equal(normaliseCode('ABCDE'), null, 'five characters is not a code');
  assert.equal(normaliseCode('ABCDEFG'), null, 'seven characters is not a code');
  assert.equal(normaliseCode(''), null);
  assert.equal(normaliseCode(null), null);
  assert.equal(normaliseCode(undefined), null);
  assert.equal(normaliseCode('AB-CDE'), null);
  assert.equal(looksLikeCode('pq4r7t'), true);
  assert.equal(looksLikeCode('nope'), false);
  assert.ok(CODE_RE.test('ABCDEF'));
});

//-------------------------------------------------------------------- the card
it('unearned points are never called pending', () => {
  const some = referralLine({ joined: 4, qualified: 2, points_each: 50 });
  assert.match(some.text, /4 joined, 2 counted/);
  // They are not pending. They arrive if and when that person contributes
  // something we keep, and they may never arrive at all.
  assert.ok(!/pending|owed|due|waiting|on the way|coming/i.test(some.text), some.text);
  // And the gap is explained rather than left as two bare numbers.
  assert.match(some.text, /add something we keep/);
});

it('a referrer with nobody yet is told the price, not their score', () => {
  const none = referralLine({ joined: 0, qualified: 0, points_each: 50 });
  assert.match(none.text, /50 points when someone you invite/);
  assert.ok(!/\b0 (joined|drivers)/.test(none.text), `a zero score on screen: ${none.text}`);
  assert.equal(none.joined, 0);
});

it('the counts cannot read as more qualified than joined', () => {
  // A stale payload, or a count read from the wrong row. Either way "2 joined,
  // 5 counted" is a screen nobody can make sense of.
  const odd = referralLine({ joined: 2, qualified: 5, points_each: 50 });
  assert.equal(odd.qualified, 2);
  for (const bad of [null, {}, { joined: -3 }, { joined: 'two', qualified: 'one' }]) {
    const l = referralLine(bad);
    assert.ok(l.joined >= 0 && l.qualified >= 0 && l.qualified <= l.joined, JSON.stringify(bad));
    assert.ok(!/NaN|undefined|null|-\d/.test(l.text), `${JSON.stringify(bad)} → ${l.text}`);
  }
});

it('all counted is said as all counted', () => {
  assert.match(referralLine({ joined: 1, qualified: 1, points_each: 50 }).text,
    /One driver joined and counted/);
  assert.match(referralLine({ joined: 3, qualified: 3, points_each: 50 }).text,
    /3 drivers joined, all 3 counted/);
});

it('the card renders nothing until it has a code and counts', () => {
  // Sliced between two lines of CODE. The first version ended the slice at the
  // "── User Menu" comment, which cut() had already stripped — so the slice ran
  // to the end of App.jsx and two checks below were satisfied by a
  // navigator.share four thousand lines away.
  const card = app.slice(app.indexOf('const ReferralCard'), app.indexOf('const UserMenu'));
  assert.match(card, /if \(!r \|\| !code\) return null;/,
    'the card renders an empty code box while it loads');
  // Minting is a separate call, so merely having the menu open is not a write
  // for somebody who never looks.
  assert.match(card, /got\?\.code \|\| \(await ensureCode\(\)\)/,
    'the code is no longer minted on first look');
});

//--------------------------------------------------- the link, and the ordering
it('a code from the URL is kept until there is an account to attach it to', () => {
  // The invited driver lands with no account and may not sign in for a week.
  // Without this, every referral link that did not end in an immediate signup
  // was lost — which is most of them.
  assert.match(app, /const ref = p\.get\('ref'\);\s*\n\s*if \(ref\) \{\s*\n\s*rememberCode\(ref\);/,
    'a referral link no longer records anything');
  // Stripped from the address bar: a referral code that stays in the URL gets
  // pasted into a tweet, and then it is everybody's.
  const at = app.indexOf("const ref = p.get('ref');");
  assert.match(app.slice(at, at + 260), /window\.history\.replaceState/,
    'the code is left in the URL to be shared by accident');
  // Claimed on sign-in, not only on load.
  const claim = app.slice(app.indexOf('claimPendingCode().then'));
  assert.match(app, /if \(!user\?\.id\) return;[\s\S]{0,400}?claimPendingCode\(\)/,
    'the waiting code is never claimed');
  // Read from AFTER the claim call: App.jsx has other effects keyed on
  // [user?.id] and a bare search for one was satisfied by those.
  assert.match(claim.slice(0, 600), /\}, \[user\?\.id\]\);/,
    'the claim does not re-run when somebody signs in');
});

it('the first friend’s link is the one that gets the credit', () => {
  // Two links, two friends. Overwriting would take the credit off whoever
  // actually persuaded them, silently.
  assert.match(client, /if \(!localStorage\.getItem\(PENDING\)\) localStorage\.setItem\(PENDING, code\)/,
    'a later link now overwrites the first');
  assert.match(client, /const code = normaliseCode\(raw\);\s*\n\s*if \(!code\) return null;/,
    'an invalid code is stored and retried forever');
});

it('a code that can never work is not retried on every page load', () => {
  // 'unknown_code' and 'own_code' will never succeed. Retrying them forever is
  // a request per load for the life of the install.
  assert.match(client, /if \(data\.reason !== 'signed_out'\) forgetCode\(\);/,
    'a hopeless code is retried forever, or a claimable one is thrown away');
  // But an unreachable server keeps it — that one WILL work later. Read from
  // inside claimPendingCode only: the same guard shape appears in two other
  // functions in this file.
  const at = client.indexOf('export async function claimPendingCode');
  const fn = client.slice(at, client.indexOf('export async function fetchReferrals'));
  assert.ok(at > 0 && fn.length > 100, 'claimPendingCode is gone');
  assert.match(fn, /if \(error \|\| !data\) return null;/,
    'a network failure now discards the code');
  assert.ok(fn.indexOf('if (error || !data) return null;') < fn.indexOf('forgetCode()'),
    'the code is forgotten before the failure is checked');
  assert.ok(!/forgetCode\(\);\s*\n\s*}\s*catch/.test(fn),
    'the code is forgotten when the request throws');
});

it('only the outcomes a person can act on are announced', () => {
  // Nobody needs to be told about a code they do not remember typing.
  assert.match(app, /reason === 'recorded' \|\| reason === 'own_code' \|\| reason === 'not_new'/,
    'every claim outcome is now announced, or none is');
  // Every reason the database can return has a sentence, so nothing falls
  // through to a shrug.
  // From claim_referral ONLY. qualify_referral's reasons ('nothing_pending',
  // 'no_invitee') are answers to the admin API and are never shown to a driver;
  // demanding copy for them would be demanding copy for nothing.
  const claimBody = mig.slice(mig.indexOf('function public.claim_referral'),
                              mig.indexOf('function public.qualify_referral'));
  const reasons = [...claimBody.matchAll(/'reason', '([a-z_]+)'/g)].map(m => m[1]);
  assert.ok(reasons.length >= 5, `only found ${reasons.length} claim reasons in the migration`);
  for (const r of reasons) {
    const msg = claimMessage(r);
    assert.ok(msg && !/Couldn’t apply that code just now/.test(msg),
      `"${r}" has no sentence of its own`);
  }
  assert.match(claimMessage('something_new'), /Couldn’t apply/,
    'an unknown reason has no fallback at all');
});

//------------------------------------------------------ paid late, and paid once
it('the referral is qualified from the approval, nowhere else', () => {
  // Exactly one place in the codebase knows "somebody's work was accepted". A
  // second place is a place that forgets.
  const fn = admin.slice(admin.indexOf('const thankYou ='), admin.indexOf('const thankYou =') + 1400);
  assert.match(fn, /rpc\/qualify_referral/, 'an accepted contribution no longer pays the referrer');
  assert.match(fn, /p_invitee_id: userId/, 'the wrong person is credited');
  assert.ok(!/await fetch\(`\$\{URL_\}\/rest\/v1\/rpc\/qualify_referral/.test(fn),
    'the referral call is awaited — a slow RPC now delays every approval');
  assert.equal((admin.match(/rpc\/qualify_referral/g) || []).length, 1,
    'qualify_referral is called from more than one place');
  // And never from the client: a driver who could qualify a referral could
  // qualify their own.
  assert.ok(!/qualify_referral/.test(client), 'the client calls qualify_referral');
  assert.ok(!/qualify_referral/.test(app), 'the app calls qualify_referral');
  assert.match(mig, /grant execute on function public\.qualify_referral\(uuid, text\) to service_role;/,
    'qualify_referral is granted to somebody who can call it from a browser');
});

it('nothing pays on signup', () => {
  // Pay on signup and you are buying signups, which cost nothing to
  // manufacture. claim_referral records; it must not award.
  const claim = mig.slice(mig.indexOf('function public.claim_referral'),
                          mig.indexOf('function public.qualify_referral'));
  assert.ok(!/award_points|qualify_referral/.test(claim),
    'claim_referral pays somebody — that is a signup bounty');
  assert.match(claim, /insert into public\.referrals/, 'claim_referral records nothing');
  // And the client cannot award either.
  assert.ok(!/award_points/.test(client), 'the client references award_points');
});

it('the share message carries the code, not just the link', () => {
  // A link gets stripped by some messaging apps and pasted without its query
  // string by people. The code read out loud is the fallback, so it has to be
  // in the words.
  const card = app.slice(app.indexOf('const ReferralCard'), app.indexOf('const UserMenu'));
  assert.match(card, /Use my code \$\{code\}/, 'the shared text no longer contains the code');
  assert.match(card, /navigator\.share/, 'there is no share sheet');
  assert.match(card, /navigator\.clipboard\.writeText/, 'there is no fallback to copying');
  assert.match(client, /https:\/\/parkeasy\.uk\/\?ref=\$\{encodeURIComponent\(code\)\}/,
    'the link no longer carries the code in the form the app reads back');
});

console.log(`\n  ${passed} checks passed\n`);
