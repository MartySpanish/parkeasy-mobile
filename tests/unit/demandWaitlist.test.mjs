// The waitlist, and the one mistake that cannot be undone.
//
// parking_requests holds people who typed their email in because there was
// nothing to book. Emailing one of them four times about the same car park
// loses the address for good — so notified_at is stamped whether or not the
// send succeeded, and that trade is the thing most of these checks protect.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const cron   = read('../../api/cron/notify-waitlist.js');
const vercel = JSON.parse(read('../../vercel.json'));
const app    = read('../../src/App.jsx');
const mig    = read('../../supabase/migrations/20260915_demand_map.sql');

const codeOnly = (src) => src
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  .split('\n').filter(l => !l.trim().startsWith('//') && !l.trim().startsWith('--')).join('\n');

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };

console.log('\ndemandWaitlist — one email each, and never a second');

it('nobody is emailed twice about the same thing', () => {
  assert.match(cron, /notified_at=is\.null/, 'the sweep no longer filters to unnotified requests');
  // Stamped AFTER the send attempt and regardless of its result. A retry loop
  // here is how you become spam.
  const loop = cron.slice(cron.indexOf('for (const m of matches)'));
  assert.ok(loop.indexOf('api.resend.com') < loop.indexOf('notified_at:'),
    'the stamp happens before the send, so a crash mid-loop would drop the email silently');
  assert.match(loop, /notified_at: new Date\(\)\.toISOString\(\)/, 'the request is no longer stamped');
  assert.ok(!/if \(r\.ok\)[\s\S]{0,200}notified_at/.test(loop),
    'the stamp is conditional on the send succeeding — that is a retry loop that mails somebody four times');
});

it('a first run cannot become a thousand emails', () => {
  assert.match(cron, /MAX_PER_RUN = (\d+)/, 'the per-run cap is gone');
  const cap = Number(cron.match(/MAX_PER_RUN = (\d+)/)[1]);
  assert.ok(cap > 0 && cap <= 200, `the cap is ${cap} — too high to be a safety net`);
  assert.match(cron, /matches\.length >= MAX_PER_RUN/, 'the cap is defined but not enforced');
});

it('it is behind CRON_SECRET', () => {
  // An open endpoint that sends email is an open endpoint that sends spam.
  assert.match(cron, /auth !== secret/, 'the sweep is no longer authenticated');
  assert.match(cron, /!secret \|\|/, 'a missing secret defaults to open');
});

it('the match is by distance, and the nearest one wins', () => {
  assert.match(cron, /RADIUS_M = 800/, 'the radius changed — 800m matches the funnel\'s own reach');
  assert.match(cron, /d <= RADIUS_M && \(!best \|\| d < best\.d\)/,
    'the nearest live listing is no longer chosen');
  assert.match(cron, /status=eq\.active/, 'draft listings would now be emailed about');
});

it('the cron is scheduled', () => {
  const c = (vercel.crons || []).find(x => x.path === '/api/cron/notify-waitlist');
  assert.ok(c, 'the waitlist sweep is not scheduled');
  assert.match(c.schedule, /^\d+ \d+ \* \* \*$/, `"${c.schedule}" is not a daily schedule`);
});

it('the search event carries the place, not the person', () => {
  // The coordinates are of the searched DESTINATION, which is what makes them
  // safe to keep — "people want parking near Botanic", not "this person was at
  // Botanic". Rounded so it cannot be a doorstep.
  assert.match(app, /Math\.round\(n \* 1000\) \/ 1000/,
    'the coordinates are no longer rounded — three decimals is about 110 metres');
  assert.match(app, /lat: String\(round\(geo\.lat\)\)/, 'the search event no longer carries a position at all');
});

it('the sources are counted separately, never summed', () => {
  // An email address and a map pan are not the same evidence. One blended
  // "demand score" is a number nobody could defend to the committee it is
  // meant to persuade.
  const sql = codeOnly(mig);
  for (const k of ['requests', 'no_results', 'parked']) {
    assert.ok(sql.includes(`'${k}',   count(*) filter`) || sql.includes(`'${k}', count(*) filter`)
      || new RegExp(`'${k}',\\s+count\\(\\*\\) filter`).test(sql),
      `${k} is no longer counted on its own`);
  }
  assert.match(app, /Counted separately, never summed/, 'the note on the admin screen is gone');
});

it('the unserved areas come first', () => {
  // A cluster with demand and no bookable space is the reason to open the
  // screen; sorting it below the served ones buries the finding.
  assert.match(app, /a\.has_listing \? 1 : -1/,
    'the demand list no longer puts the unserved areas first');
});

console.log(`\n  ${passed} checks passed\n`);
