// A rewards screen is the easiest place in an app to make a promise.
//
// "You're almost there!", "1,240 points!", "Only 40 away!" — none of those are
// facts, and two of them are about a currency the company invented to thank you
// with. So the checks here are about what the balance is allowed to SAY, and
// about the one property that keeps the whole thing honest: a point is a claim
// on Premium days, which already has a price in pounds, so the tariff cannot be
// inflated without giving away something that would otherwise have been sold.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  pointsSummary, EARN_WAYS, ledgerLabel, LEDGER_LABELS,
} from '../../src/data/pointsCore.js';

const cut = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
  .replace(/^\s*--.*$/gm, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/^\s*\/\*[\s\S]*?\*\//gm, '')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const mig   = cut('../../supabase/migrations/20260918_contribution_points.sql');
const app   = cut('../../src/App.jsx');
const admin = cut('../../api/admin.js');
const client = cut('../../src/data/points.js');

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };

console.log('\npoints — a thank-you that is worth something, and says only what it is');

//------------------------------------------------------------------ what it says
it('the line is a fact about two numbers, never an opinion about progress', () => {
  const near = pointsSummary({ balance: 80, cost: 100, days: 30 });
  assert.match(near.text, /20 more points for 30 days of Premium/);
  // "Almost there" is an opinion, and dressing 80 of 100 as almost-there is
  // how a rewards screen starts lying in small ways.
  for (const s of [near, pointsSummary({ balance: 99, cost: 100, days: 30 })]) {
    assert.ok(!/almost|nearly|so close|keep going|well done/i.test(s.text), s.text);
  }
  assert.match(pointsSummary({ balance: 99, cost: 100, days: 30 }).text, /^1 more point /,
    'one point is not "1 more points"');
  assert.match(pointsSummary({ balance: 0, cost: 100, days: 30 }).text,
    /100 points is 30 days of Premium/,
    'a driver with nothing is told the price, not how far behind they are');
});

it('the bar fills, and stops', () => {
  assert.equal(pointsSummary({ balance: 0, cost: 100 }).progress, 0);
  assert.equal(pointsSummary({ balance: 50, cost: 100 }).progress, 0.5);
  assert.equal(pointsSummary({ balance: 100, cost: 100 }).progress, 1);
  // 300 points is not 300% of the way to a 30-day reward; it is three of them
  // waiting, and a bar overflowing its track is a rendering bug on a phone.
  assert.equal(pointsSummary({ balance: 300, cost: 100 }).progress, 1);
  assert.match(app, /Math\.round\(s\.progress\*100\)/, 'the bar no longer reads the capped value');
});

it('the reward is only offered when the server says it can be given', () => {
  // can_redeem comes from my_points(); the balance check is belt and braces
  // against a stale payload, not the authority.
  assert.equal(pointsSummary({ balance: 100, cost: 100, can_redeem: true }).ready, true);
  assert.equal(pointsSummary({ balance: 100, cost: 100, can_redeem: false }).ready, false,
    'the client offers a reward the server will refuse');
  assert.equal(pointsSummary({ balance: 40, cost: 100, can_redeem: true }).ready, false,
    'a stale can_redeem offers a reward the balance cannot pay for');
  assert.match(pointsSummary({ balance: 100, cost: 100, can_redeem: true }).text,
    /Enough for 30 days/);
  // And the button is behind that flag, not shown greyed out: an offer you
  // cannot take is worse than no offer.
  assert.match(app, /\{s\.ready && \(/, 'the redeem button is no longer gated on readiness');
});

it('a missing or broken payload never reaches the screen as a number', () => {
  for (const bad of [null, undefined, {}, { balance: -50 }, { balance: 'lots' }]) {
    const s = pointsSummary(bad);
    assert.equal(s.balance, 0, JSON.stringify(bad));
    assert.equal(s.ready, false);
    assert.ok(!/NaN|undefined|null|-/.test(s.text), `${JSON.stringify(bad)} → ${s.text}`);
    assert.ok(s.progress >= 0 && s.progress <= 1, `progress ${s.progress}`);
  }
  // A zero cost would be a divide-by-zero in the bar and a free reward in the
  // sentence.
  assert.equal(pointsSummary({ balance: 10, cost: 0 }).cost, 100);
  assert.ok(Number.isFinite(pointsSummary({ balance: 10, cost: 0 }).progress));
});

it('the card shows nothing rather than a zero it has not checked', () => {
  // A rewards card that flashes "0 points" while it loads has told the driver
  // they have nothing, and for most of them that is the only thing they read.
  assert.match(app, /const \[p, setP\] = useState\(null\);[\s\S]{0,400}?if \(!p\) return null;/,
    'the points card renders before it has a balance');
});

//--------------------------------------------------------- the tariff, both sides
it('the earn list matches the tariff the database pays', () => {
  for (const w of EARN_WAYS) {
    const m = mig.match(new RegExp(`when '${w.kind}'\\s*then (\\d+)`));
    assert.ok(m, `the client advertises "${w.kind}" and the database does not price it`);
    assert.equal(Number(m[1]), w.points,
      `the client advertises ${w.points} for ${w.kind} and the database pays ${m[1]}`);
  }
  // Nothing priced is left unadvertised either: a driver cannot earn something
  // they were never told about.
  const priced = [...mig.matchAll(/when '([a-z_]+)'\s*then \d+/g)].map(m => m[1]);
  for (const kind of priced) {
    assert.ok(EARN_WAYS.some(w => w.kind === kind),
      `the database pays for "${kind}" and the app never says so`);
  }
});

it('nothing is paid for the act of submitting', () => {
  // Points for submitting pay for junk, and a queue of junk is how the
  // moderation that keeps 744 spots accurate stops being possible.
  for (const kind of ['spot_submitted', 'photo_uploaded', 'report_filed', 'signup', 'signin']) {
    assert.ok(!new RegExp(`when '${kind}'`).test(mig),
      `"${kind}" is priced — that pays for submitting rather than for accepted work`);
    assert.ok(!EARN_WAYS.some(w => w.kind === kind), `"${kind}" is advertised as earning`);
  }
  // Every advertised way is either reviewed by a human or capped.
  const capped = mig.match(/case p_kind when '([a-z_]+)' then (\d+) else null end/);
  assert.ok(capped, 'the daily cap is gone');
  for (const w of EARN_WAYS) {
    const reviewed = /_approved$|_accurate$/.test(w.kind);
    assert.ok(reviewed || w.kind === capped[1],
      `"${w.kind}" is neither reviewed nor capped — it can be farmed`);
    assert.ok(reviewed || /a day/i.test(w.note),
      `"${w.kind}" is capped and the app does not say so: ${w.note}`);
  }
});

it('the reviewed contribution is worth far more than the tap', () => {
  const tap = EARN_WAYS.find(w => w.kind === 'signal');
  const spot = EARN_WAYS.find(w => w.kind === 'spot_approved');
  assert.ok(spot.points >= 20 * tap.points,
    'tapping becomes the rational way to earn, and the review queue gets nothing');
});

//----------------------------------------------------- paid on approval, once
it('the award is fired from the approval, not from the submission', () => {
  // If this ever moves, the queue fills with junk.
  const approve = admin.slice(admin.indexOf("if (kind === 'spot')"), admin.indexOf("const lr = await fetch"));
  assert.match(approve, /if \(action === 'approve'\) thankYou\(sub\.user_id, 'spot_approved', id\)/,
    'an approved spot no longer thanks the person who found it');
  assert.ok(!/action === 'reject'[\s\S]{0,300}?thankYou/.test(approve),
    'a rejected spot is paid for');

  const photo = admin.slice(admin.indexOf("if (kind === 'spot_photo')"), admin.indexOf("if (kind === 'spot')"));
  assert.match(photo, /if \(action === 'approve'\)/, 'a photo is thanked whatever the decision');
  assert.match(photo, /thankYou\(who, 'photo_approved', id\)/, 'an approved photo is not thanked');

  // A report is paid when it turns out to be RIGHT, not when it is filed — and
  // the reporters are read before the rows are closed, because resolving
  // stamps resolved_at and after that there is nothing left to read.
  const resolve = admin.slice(admin.indexOf("'resolve-spot-reports'"),
                              admin.indexOf("'resolve-spot-reports'") + 2600);
  assert.match(resolve, /if \(p\.accurate\)/,
    'every resolved report is paid, so reporting every spot on the map pays');
  assert.ok(resolve.indexOf('reporter_id=not.is.null') < resolve.indexOf('rpc/resolve_spot_reports'),
    'the reporters are read after the rows are closed, so nobody is ever paid');
  assert.match(resolve, /thankYou\(who, 'report_accurate', key\)/, 'a correct report is not thanked');
});

it('a thank-you can never fail an approval', () => {
  // The spot going live matters to every driver; the points are a courtesy to
  // one. So the award is fired and not awaited, and it cannot throw.
  // Sliced at the arrow function's own closing brace. Anchoring on the comment
  // that follows it does not work: cut() has already stripped every comment, so
  // the slice ran to the end of the file — which is how the count below would
  // have been satisfied by unrelated code.
  const from = admin.indexOf('const thankYou =');
  const fn = admin.slice(from, admin.indexOf('\n  };', from) + 5);
  assert.ok(fn.length > 200 && fn.length < 2000, `thankYou slice looks wrong (${fn.length} chars)`);
  assert.ok(!/await/.test(fn), 'the award is awaited — a slow RPC now delays every approval');
  // EVERY fetch, counted. thankYou fires two RPCs now (the points and the
  // referral), and a bare search for one .catch was satisfied by the second
  // while the first went unguarded.
  const fetches = (fn.match(/fetch\(/g) || []).length;
  const catches = (fn.match(/\.catch\(\(\) => \{\}\)/g) || []).length;
  assert.ok(fetches > 0, 'thankYou no longer calls anything');
  assert.equal(catches, fetches,
    `${fetches} requests and ${catches} catches — a failed one now breaks the approval`);
  assert.match(fn, /if \(!userId \|\| !SERVICE\) return;/,
    'an anonymous submission or a missing service key reaches the RPC');
  // And it is declared before the first handler that calls it: a const is not
  // hoisted, and the report resolver sits hundreds of lines above the founder
  // actions.
  assert.ok(admin.indexOf('const thankYou =') < admin.indexOf("'resolve-spot-reports'"),
    'thankYou is used above its own declaration — a ReferenceError on every resolve');
});

//-------------------------------------------------------------- the client half
it('there is no path from the app to awarding anything', () => {
  // award_points() is a mint. It is granted to service_role only, and the
  // client must not even know the name.
  assert.ok(!/award_points/.test(client), 'the client references award_points');
  assert.ok(!/award_points/.test(app), 'the app references award_points');
  assert.match(mig, /grant execute on function public\.award_points\(uuid, text, text\) to service_role;/,
    'award_points is granted to somebody who can call it from a browser');
  assert.ok(!/grant execute on function public\.award_points[^;]*to (anon|authenticated)/.test(mig),
    'a driver can award their own points');
  // And the two the client does call take no account argument, so there is
  // nothing to point at somebody else.
  assert.match(client, /supabase\.rpc\('my_points'\)/, 'the balance is read some other way');
  assert.match(client, /supabase\.rpc\('redeem_points'\)/, 'the reward is claimed some other way');
  assert.ok(!/p_user_id/.test(client), 'the client names an account');
});

it('"not enough yet" is not reported as "something went wrong"', () => {
  // The two are not the same and only one of them is the driver's business.
  assert.match(app, /r\.reason === 'not_enough'/, 'a shortfall is now an error message');
  const card = app.slice(app.indexOf('const PointsCard'), app.indexOf('const ReferralCard'));
  assert.match(card, /more points/, 'the shortfall no longer says how many');
  assert.match(card, /days of Premium added/, 'a successful redemption says nothing');
  // Premium starts the moment it is granted rather than on the next reload.
  assert.match(app, /onRedeemed=\{\(until\)=>\{[\s\S]{0,500}?setIsPremium\(true\)/,
    'the gems stay locked after the points were spent on unlocking them');
});

//------------------------------------------------------------------ the history
it('a ledger row the client does not recognise still reads as something', () => {
  assert.equal(ledgerLabel('spot_approved'), 'Spot added to the map');
  assert.equal(ledgerLabel('redeemed'), 'Redeemed for Premium');
  // A row a later deploy added must not render as a bare "+25" with no label —
  // a balance that does not add up on screen is worse than a vague line.
  assert.equal(ledgerLabel('something_new'), 'Contribution');
  assert.equal(ledgerLabel(undefined), 'Contribution');
  // Every kind the database can write has a label.
  const kinds = [...mig.matchAll(/when '([a-z_]+)'\s*then \d+/g)].map(m => m[1]);
  for (const k of [...kinds, 'redeemed']) {
    assert.ok(LEDGER_LABELS[k], `"${k}" has no label, so the history reads as "Contribution"`);
  }
});

console.log(`\n  ${passed} checks passed\n`);
