// "Confirmed by 0 drivers" — the line that was on all 744 spots.
//
// The app asked every driver the most valuable question it has: is this still
// here? Two buttons, 👍 Still here and 👎 Changed. Still here wrote localStorage
// and was read back by the same phone; Changed wrote a different localStorage
// key that nothing read at all. Above them sat a green tick and a count made of
// a seed field.
//
// So the checks here are about the three ways a community count lies: it can be
// made up, it can be inflated by one person tapping, and it can be true on one
// device and nowhere else.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  signalSummary, mergeLegacySignals, nextSignal, SIGNALS,
} from '../../src/data/spotSignalsCore.js';

// Comments are stripped before anything is matched. A check that fires on its
// own explanation is a check that passes on nothing, and this suite has the
// word "confirmed" in half its prose.
const cut = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/^\s*\/\*[\s\S]*?\*\//gm, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const app = cut('../../src/App.jsx');
const mig = cut('../../supabase/migrations/20260917_spot_signals.sql');
const client = cut('../../src/data/spotSignals.js');
const reports = cut('../../src/data/spotReports.js');

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };

console.log('\nspotSignals — a count of drivers that is a count of drivers');

//--------------------------------------------------- nothing said is said as nothing
it('a spot nobody has answered about does not claim a verdict', () => {
  const none = signalSummary(undefined, null);
  assert.equal(none.tone, 'quiet');
  assert.equal(none.confirmed, 0);
  // The specific sentence that was wrong: a count of zero, printed as a count.
  assert.ok(!/\b0 drivers?\b/.test(none.text), `still prints a zero count: ${none.text}`);
  assert.ok(!/confirmed by/i.test(none.text), `still claims confirmation: ${none.text}`);
  assert.match(none.text, /Been here\?/, 'the empty state should ask, not report');
  assert.equal(signalSummary({ confirmed: 0, changed: 0 }, null).tone, 'quiet');
});

it('a driver’s own answer is acknowledged even before the count catches up', () => {
  // No database behind the build, or a request that did not land. Without this
  // the sheet read "Nobody has confirmed this one recently" beside "you
  // confirmed just now".
  const mine = signalSummary({}, 'confirmed');
  assert.notEqual(mine.tone, 'quiet');
  assert.match(mine.text, /^You /, mine.text);
  const changed = signalSummary({}, 'changed');
  assert.equal(changed.tone, 'disputed');
  assert.match(changed.text, /^You /, changed.text);
});

//---------------------------------------------------------------- what it says
it('the line counts drivers, in the plural only when there is more than one', () => {
  assert.match(signalSummary({ confirmed_30d: 1 }).text, /^1 driver confirmed/);
  assert.match(signalSummary({ confirmed_30d: 4 }).text, /^4 drivers confirmed/);
  assert.match(signalSummary({ confirmed_30d: 4 }, 'confirmed').text, /including you$/);
  assert.ok(!/including you/.test(signalSummary({ confirmed_30d: 4 }, null).text));
  // The recent count leads, because "is this still true?" is the question the
  // driver is actually asking.
  assert.match(signalSummary({ confirmed: 90, confirmed_30d: 2 }).text, /^2 drivers/);
  // And the all-time count is used when there is no recent one to read.
  assert.match(signalSummary({ confirmed: 7 }).text, /^7 drivers/);
});

it('both sides are shown, and neither becomes a ruling', () => {
  const split = signalSummary({ confirmed_30d: 9, changed_30d: 2 });
  assert.match(split.text, /9 confirmed/);
  assert.match(split.text, /2 said it has changed/);
  // Nine against two is a spot worth a second look, not a spot to pull: the
  // two may have arrived during resurfacing, and a spot deletable on two taps
  // is a spot anybody can vandalise off the map.
  assert.equal(split.tone, 'confirmed');
  assert.ok(!/\b(gone|wrong|closed|unavailable)\b/i.test(split.text), split.text);
  // Level, or worse, and the tone flips — but the sentence still reports both.
  assert.equal(signalSummary({ confirmed_30d: 2, changed_30d: 2 }).tone, 'disputed');
  assert.equal(signalSummary({ confirmed_30d: 1, changed_30d: 5 }).tone, 'disputed');
  assert.match(signalSummary({ confirmed_30d: 1, changed_30d: 5 }).text, /1 confirmed/);
  assert.equal(signalSummary({ changed_30d: 3 }).tone, 'disputed');
  assert.match(signalSummary({ changed_30d: 3 }).text, /^3 drivers said/);
});

it('a nonsense count is treated as no count, never as a number on screen', () => {
  for (const bad of [{ confirmed_30d: -5 }, { confirmed_30d: 'lots' }, { confirmed_30d: null }]) {
    const out = signalSummary(bad, null);
    assert.equal(out.confirmed, 0, JSON.stringify(bad));
    assert.ok(!/-|NaN|lots/.test(out.text), out.text);
  }
  assert.equal(signalSummary({ confirmed_30d: 3 }, 'brilliant').mine, null,
    'an unknown signal is not attributed to the driver');
});

//------------------------------------------------------------------ the buttons
it('tapping the answer you already gave takes it back', () => {
  // Still here used to disable itself on the first tap, so a mis-tap counted
  // for good.
  assert.equal(nextSignal('confirmed', 'confirmed'), null);
  assert.equal(nextSignal('changed', 'changed'), null);
  assert.equal(nextSignal('confirmed', 'changed'), 'changed');
  assert.equal(nextSignal(null, 'confirmed'), 'confirmed');
  assert.match(app, /onClick=\{\(\)=>say\('confirmed'\)\}/, 'the confirm button no longer says anything');
  assert.match(app, /onClick=\{\(\)=>say\('changed'\)\}/, 'the changed button is inert again');
  assert.match(app, /nextSignal\(mySignal, signal\)/, 'the buttons no longer toggle');
  assert.ok(!/disabled=\{voted\}/.test(app), 'the confirm button disables itself on the first tap again');
});

it('months of taps on the old keys still show on the buttons', () => {
  const merged = mergeLegacySignals(null, { 7: true, 9: true }, { 9: 'changed', 11: 'changed' });
  assert.equal(merged[7], 'confirmed');
  assert.equal(merged[11], 'changed');
  // pe_votes was write-once and pe_ratings could be toggled, so a spot in both
  // was confirmed after being un-changed.
  assert.equal(merged[9], 'confirmed');
  // Once the new key exists it is the only truth; re-reading the old ones would
  // resurrect an answer the driver has since taken back.
  assert.deepEqual(mergeLegacySignals({ 1: 'changed' }, { 2: true }, {}), { 1: 'changed' });
  assert.deepEqual(mergeLegacySignals({}, { 2: true }, {}), {});
  assert.deepEqual(mergeLegacySignals(null, {}, {}), {});
  assert.match(app, /mergeLegacySignals\(ls\.get\('pe_signals', null\), ls\.get\('pe_votes', \{\}\), ls\.get\('pe_ratings', \{\}\)\)/,
    'the old taps are no longer migrated in');
});

//--------------------------------------------------- the count comes from the server
it('the app never increments its own count', () => {
  // This is the whole defect: "Confirmed by 1 driver" was true on one phone and
  // false everywhere else.
  assert.ok(!/spot\.votes\s*\|\|\s*0\)\s*\+\s*\(/.test(app),
    'the sheet builds a confirmation count out of the seed field and this browser again');
  assert.ok(!/confirmCount/.test(app), 'the locally-derived count is back');
  assert.match(app, /const community = signalSummary\(signalCounts, mySignal\)/,
    'the sheet no longer reads the server counts');
  // The fresh count returned by the RPC is what is stored; a failure re-reads
  // rather than guessing.
  assert.match(app, /if \(fresh\) \{\s*\n\s*setSignalCounts\(prev => \(\{ \.\.\.prev, \[String\(id\)\]: fresh \}\)\)/,
    'the server’s count is no longer used');
  assert.match(app, /\} else \{[\s\S]{0,400}?loadSignalCounts\(\);/,
    'a failed or withdrawn signal leaves a stale count on screen');
  assert.match(client, /const \{ data, error \} = await supabase\.rpc\('set_spot_signal'/,
    'the client writes signals some other way than the function');
  assert.match(mig, /returns json/, 'set_spot_signal no longer returns the counts');
});

it('no count is claimed as driver confirmations when it is a seed weight', () => {
  // `votes` is a ranking weight in the seed data: 297 spots carry one, none of
  // it given by a driver. It may order a list; it may not be called popularity.
  assert.ok(!/Most Popular/.test(app),
    'a sort ordered by the seed weight is labelled as the drivers’ doing again');
  assert.ok(app.includes("{ id:'popular', label:'Recommended' }"), 'the free sort label moved');
  assert.ok(app.includes("{ id:'popular',  label:'Recommended' }"), 'the premium sort label moved');
  // And the sheet's community line does not read the seed field at all.
  const sheet = app.slice(app.indexOf('const community = signalSummary'),
                          app.indexOf('const reportHref='));
  assert.ok(!/votes/.test(sheet), `the sheet reads the seed weight again: ${sheet}`);
});

//------------------------------------------------------------- one write surface
it('signals and reports both go through a function, not an insert', () => {
  // An anonymous INSERT into a table that feeds what other drivers are shown is
  // a table somebody will fill.
  assert.ok(!/from\('spot_reports'\)\.insert/.test(reports),
    'reports are inserted directly again — the ungated path is back');
  assert.match(reports, /supabase\.rpc\('report_spot'/, 'reports no longer go through the function');
  assert.match(mig, /drop policy if exists spot_reports_insert on public\.spot_reports;/,
    'the old insert policy is left in place beside the function');
  assert.match(mig, /revoke all on public\.spot_reports from anon, authenticated;/,
    'anon can still write spot_reports directly');
  assert.match(mig, /revoke all on public\.spot_signals from anon, authenticated;/,
    'the raw signals are readable');
  for (const fn of ['set_spot_signal', 'clear_spot_signal', 'report_spot']) {
    const at = mig.indexOf(`function public.${fn}(`);
    assert.ok(at > 0, `${fn} is gone`);
    const body = mig.slice(at, at + 3000);
    assert.match(body, /security definer/, `${fn} is not SECURITY DEFINER`);
    assert.match(body, /set search_path = public, pg_temp/, `${fn} does not pin its search_path`);
  }
  // reporter_id and user_id come from auth.uid() inside the function, so a
  // signal cannot be attributed to somebody else's account.
  assert.ok(!/p_user_id|p_reporter_id/.test(mig),
    'a caller can name whose signal this is');
  assert.ok(!/reporter_id:/.test(reports), 'the client sends a reporter id again');
});

it('the session id is what identifies a browser, and it is sent', () => {
  // The same anonymous id push_subscriptions is keyed on. Not the account: the
  // driver standing at the spot usually has no account, and demanding one to
  // answer "is this still there?" is how you get no answers.
  for (const call of ['set_spot_signal', 'clear_spot_signal']) {
    const at = client.indexOf(`rpc('${call}'`);
    assert.ok(at > 0, `${call} is not called`);
    // Bounded at the END of that call. A fixed window ran past it into the
    // next rpc(), whose source id then satisfied the check for both — the
    // fifth time in this repo a check has passed on somebody else's line.
    const end = client.indexOf('});', at);
    assert.ok(end > at, `${call} call is not closed`);
    assert.match(client.slice(at, end), /p_source_id: sessionId\(\)/,
      `${call} does not say which browser it is`);
  }
  assert.match(reports, /p_source_id: sessionId\(\)/, 'a report no longer says which browser filed it');
  // Argument names are compared against the migration character by character:
  // a renamed parameter means PostgREST cannot find the function and every
  // answer is silently dropped.
  for (const arg of ['p_spot_key', 'p_source_id', 'p_signal']) {
    assert.ok(mig.includes(arg), `${arg} is not a parameter of anything in the migration`);
  }
});

it('the reason list the sheet offers is the list the database accepts', () => {
  const offered = [...reports.matchAll(/\{ id: '([a-z_]+)',/g)].map(m => m[1]);
  assert.ok(offered.length >= 4, `only found ${offered.length} reasons`);
  const accepted = mig.match(/p_reason not in \(([^)]+)\)/);
  assert.ok(accepted, 'the database no longer checks the reason at all');
  for (const r of offered) {
    assert.ok(accepted[1].includes(`'${r}'`), `the sheet offers "${r}" and the database does not accept it`);
  }
});

it('SIGNALS matches what the database allows', () => {
  const check = mig.match(/check \(signal in \(([^)]+)\)\)/);
  assert.ok(check, 'the signal column no longer constrains its values');
  for (const s of SIGNALS) {
    assert.ok(check[1].includes(`'${s}'`), `the client offers "${s}" and the database refuses it`);
  }
  assert.equal(SIGNALS.length, check[1].split(',').length,
    'the client and the database disagree on how many kinds of signal there are');
});

console.log(`\n  ${passed} checks passed\n`);
