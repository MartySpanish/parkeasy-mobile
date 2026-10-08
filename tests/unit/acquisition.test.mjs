// Where visitors come from, and the three funnel events that had no emitter.
//
// 239 events across 47 sessions and no referrer recorded anywhere, so nobody
// could say whether a single visit came from Google, Facebook, a printed QR
// code or Marty's own phone. Section 19 of the growth brief asks for organic /
// paid / direct / social / referral / AI splits; none of it was collectable.
//
// Three allowlisted events also had no emitter at all: booking_abandoned
// (where checkout dies), submit_spot_start and submit_spot_done (the host
// funnel, which is why "3 of 6 listings are drafts" was a floor rather than a
// measurement).
//
// Every assertion was confirmed by breaking the rule it covers.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classify } from '../../src/data/acquisitionSource.js';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
/** Source with // comments stripped: a regex must match code, not a note about it. */
const code = p => read(p).split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');

const ME = 'parkeasy.uk';
let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };

console.log('\nacquisition — say where the visit came from');

//------------------------------------------------------------------ channels
it('a search engine is organic, and names which one', () => {
  for (const h of ['https://www.google.com/search?q=belfast+parking',
    'https://duckduckgo.com/', 'https://search.yahoo.com/', 'https://www.bing.com/']) {
    const r = classify(h, '', ME);
    assert.equal(r.ch, 'organic', `${h} → ${r.ch}`);
    assert.ok(r.src, `${h} lost its source`);
  }
});

it('an assistant is its own channel, not lumped in with organic', () => {
  // Mutation: delete the AI list and these fall to 'referral'. Section 9 of the
  // brief is about being a source an AI recommends, which cannot be measured if
  // ChatGPT is filed under Google.
  for (const h of ['https://chatgpt.com/', 'https://www.perplexity.ai/',
    'https://gemini.google.com/', 'https://claude.ai/']) {
    assert.equal(classify(h, '', ME).ch, 'ai', h);
  }
  // gemini.google.com must NOT be read as google = organic. Order of the
  // checks is what decides this.
  assert.equal(classify('https://gemini.google.com/app', '', ME).src, 'gemini.google.com');
});

it('social is social, including the link-shim hosts', () => {
  // l.facebook.com and t.co are what actually appear in a referrer; matching
  // only 'facebook.com' and 'twitter.com' would file both as referral.
  for (const h of ['https://l.facebook.com/l.php', 'https://t.co/abc',
    'https://www.instagram.com/', 'https://lnkd.in/x', 'https://www.tiktok.com/']) {
    assert.equal(classify(h, '', ME).ch, 'social', h);
  }
});

it('a paid click beats its own referrer', () => {
  // THE ONE THAT MATTERS COMMERCIALLY. A Facebook ad arrives with BOTH a
  // facebook.com referrer and utm_medium=cpc. Mutation: move the paid check
  // below the host checks and every pound of ad spend reads as free social.
  const r = classify('https://l.facebook.com/', '?utm_medium=cpc&utm_source=facebook&utm_campaign=matchday', ME);
  assert.equal(r.ch, 'paid', JSON.stringify(r));
  assert.equal(r.src, 'facebook');
  assert.equal(r.cmp, 'matchday');
  for (const m of ['ppc', 'paid', 'cpm', 'display']) {
    assert.equal(classify('https://www.google.com/', `?utm_medium=${m}`, ME).ch, 'paid', m);
  }
});

it("a printed sticker's own src parameter is read, even via the /q/ hop", () => {
  // All 26 rows in qr_codes land on `?src=<code>`, and those stickers are on
  // walls and cannot be reprinted. Mutation: drop srcParam and every scan
  // since the first sticker went up reads as 'direct' — which is what it did
  // before this line existed.
  assert.deepEqual(classify('', '?src=fl', ME), { ch: 'offline', src: 'fl' });
  assert.deepEqual(classify('', '?src=gaa', ME), { ch: 'offline', src: 'gaa' });
  // api/q.js answers with a 302, and some browsers carry the /q/ URL as the
  // referrer across that hop. Checking the host first would file the scan as
  // an internal navigation. Mutation: move the offline branch below the host
  // checks and this becomes 'internal'.
  assert.equal(classify('https://parkeasy.uk/q/fl', '?src=fl', ME).ch, 'offline');
  // A paid click still outranks it: the ad is what was paid for.
  assert.equal(classify('https://l.facebook.com/', '?src=x&utm_medium=cpc&utm_source=fb', ME).ch, 'paid');
});

it('a QR code and a flyer are offline, not direct', () => {
  // A printed code has no referrer, so without this it is indistinguishable
  // from somebody typing the address — which is the whole reason every flyer
  // needs a utm. Mutation: drop the offline branch → 'other' or 'direct'.
  assert.deepEqual(classify('', '?utm_medium=qr&utm_source=davitts-flyer', ME),
    { ch: 'offline', src: 'davitts-flyer' });
  assert.equal(classify('', '?utm_medium=flyer', ME).ch, 'offline');
});

it('our own pages are internal, never a referral from ourselves', () => {
  // Mutation: delete the selfHost check and every in-site navigation inflates
  // the referral channel with parkeasy.uk.
  assert.equal(classify('https://parkeasy.uk/area/belfast.html', '', ME).ch, 'internal');
  assert.equal(classify('https://www.parkeasy.uk/events', '', ME).ch, 'internal');
  // A subdomain is still us; a lookalike is not.
  assert.equal(classify('https://app.parkeasy.uk/', '', ME).ch, 'internal');
  assert.equal(classify('https://notparkeasy.uk/', '', ME).ch, 'referral');
});

it('no referrer and no utm says direct rather than guessing', () => {
  assert.deepEqual(classify('', '', ME), { ch: 'direct' });
  assert.deepEqual(classify('', '', ''), { ch: 'direct' });
});

it('an unknown site is a named referral', () => {
  const r = classify('https://www.belfastlive.co.uk/whats-on', '', ME);
  assert.equal(r.ch, 'referral');
  assert.equal(r.src, 'belfastlive.co.uk', 'the www. was not stripped');
});

it('garbage in does not throw and does not invent a channel', () => {
  // A referrer is attacker-controlled in the sense that any site can set it.
  for (const bad of ['not a url', 'javascript:alert(1)', '://', null, undefined]) {
    const r = classify(bad, '?utm_medium=%%%', ME);
    assert.ok(r && typeof r.ch === 'string', `threw or lost ch on ${String(bad)}`);
  }
  // Long values are cut, because props are capped at 200 chars server-side and
  // one enormous campaign name would push out every other key.
  const long = 'x'.repeat(500);
  const r = classify('', `?utm_medium=email&utm_source=${long}&utm_campaign=${long}`, ME);
  assert.ok(r.src.length <= 40, `src is ${r.src.length} chars`);
  assert.ok(r.cmp.length <= 40, `cmp is ${r.cmp.length} chars`);
});

//-------------------------------------------------------------------- wiring
it('attribution rides the first event of a session and no others', () => {
  const src = code('../../src/analytics.js');
  assert.match(src, /import \{ currentSource \} from '\.\/data\/acquisitionSource\.js'/,
    'analytics.js no longer imports the classifier');
  assert.match(src, /firstOfSession\(\) \? \{ \.\.\.currentSource\(\), \.\.\.\(props \|\| \{\}\) \}/,
    'the merge changed shape — a caller prop must still win over attribution');
  assert.match(src, /p_props: props2/, 'the enriched props never reach the RPC');
  assert.match(src, /mirror\(name, props2\)/, 'funnel.js sees the un-enriched props');
  // THE ORDER BUG THIS CAUGHT. firstOfSession() is a one-shot: asking it above
  // the throttle meant a dropped map_move could consume the only chance to
  // record where the visit came from.
  assert.ok(src.indexOf('const gap = THROTTLE_MS') < src.indexOf('firstOfSession()'),
    'attribution is computed before the throttle, so a throttled event can eat it');
});

it('the three emitterless funnel events now have emitters', () => {
  const app = code('../../src/App.jsx');
  for (const e of ['booking_abandoned', 'submit_spot_start', 'submit_spot_done']) {
    assert.match(app, new RegExp(`track\\('${e}'`), `${e} still has no emitter`);
  }
});

it('a handoff to Stripe is not counted as an abandonment', () => {
  // The expensive mistake: firing booking_abandoned on every unmount would
  // label every SUCCESSFUL checkout as abandoned, because the sheet unmounts
  // on the redirect. Mutation: drop the redirecting guard and the metric
  // inverts.
  const app = code('../../src/App.jsx');
  assert.match(app, /if \(st\.redirecting\) return;/,
    'the redirect guard is gone — every completed checkout now reads as abandoned');
  // And the flag must be set BEFORE the navigation, which may start
  // synchronously.
  const pay = app.slice(app.indexOf("track('booking_start'"));
  assert.ok(pay.indexOf('stageRef.current.redirecting = true') < pay.indexOf('window.location.href = url'),
    'the redirect flag is set after the navigation begins');
});

it('the abandonment says how far they got, and why if the server refused', () => {
  const app = code('../../src/App.jsx');
  assert.match(app, /stage: st\.failed \? 'refused' : st\.started \? 'submitted' : 'browsing'/,
    'the stage collapsed — browsing, submitted and refused are three different problems');
  assert.match(app, /stageRef\.current\.failed = String\(e\?\.code/,
    "the server's refusal code is no longer recorded, so slot_taken and "
    + 'too_soon look identical in the funnel');
});

it('every new event name is on the allowlist the server enforces', () => {
  // The client list is a development convenience; the migration is what
  // decides. An emitter for a name the RPC rejects is silently dropped.
  const analytics = read('../../src/analytics.js');
  const migration = read('../../supabase/migrations/20260902_app_events_ingest.sql');
  for (const e of ['booking_abandoned', 'submit_spot_start', 'submit_spot_done']) {
    assert.ok(analytics.includes(`'${e}'`), `${e} missing from the client allowlist`);
    assert.ok(migration.includes(e), `${e} missing from the server allowlist`);
  }
});

console.log(`\n  ${passed} checks passed\n`);
