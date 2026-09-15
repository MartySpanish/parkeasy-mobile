// A pass credit is money already taken. Two ways it goes wrong.
//
//   1. It books a driveway without asking the host. api/passes.js predates the
//      host-approval work and wrote status 'paid' directly.
//   2. It is spent and nothing is booked. The decrement happens first — right,
//      because the other order hands out a free booking — so a failed insert
//      ate it.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const passes  = read('../../api/passes.js');
const respond = read('../../api/bookings/respond.js');
const sweep   = read('../../api/cron/expire-approvals.js');

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };

console.log('\npassApproval — a pass does not buy a bypass');

it('a pass booking on a driveway is a request, not a confirmation', () => {
  assert.match(passes, /requires_host_approval/,
    'the redeem path no longer reads whether the listing needs approval');
  assert.match(passes, /status: needsApproval \? 'awaiting_host' : 'paid'/,
    'a pass booking is written as paid regardless — the driveway host is never asked');
  assert.match(passes, /requires_host_approval: needsApproval/,
    'the booking no longer records that it needed approval');
  assert.match(passes, /select=id,title,owner_id,status,spaces,requires_host_approval/,
    'the flag is not even fetched with the listing');
});

it('the deadline never outlives the parking slot', () => {
  assert.match(passes, /Math\.min\(Date\.now\(\) \+ 24 \* 3600000, startMs\)/,
    'a pass request could sit past the time it was booked for');
});

it('a failed booking gives the credit back', () => {
  const fail = passes.slice(passes.indexOf('if (!ins.ok)'), passes.indexOf('if (!ins.ok)') + 900);
  assert.match(fail, /rpc\/restore_pass_credit/,
    'a failed insert still eats the credit — the driver paid for ten and can use nine');
  assert.match(fail, /your credit has not been used/,
    'the driver is not told their credit survived');
  // Order matters: decrement first protects against double-spend.
  assert.ok(passes.indexOf('rpc/redeem_pass_credit') < passes.indexOf('rpc/restore_pass_credit'),
    'the restore is attempted before the redeem, which makes no sense');
});

it('a host saying no does not cost a credit', () => {
  assert.match(respond, /booking\.pass_purchase_id/, 'the decline path no longer notices a pass booking');
  assert.match(respond, /rpc\/restore_pass_credit/, 'declining a pass booking eats the credit');
  // A pass booking has no card to release, so cancelling a PaymentIntent is not
  // the fix — the credit is.
  const decline = respond.slice(respond.indexOf('// Decline.'));
  assert.ok(decline.indexOf('restore_pass_credit') > 0, 'the credit is not restored on the decline path');
});

it('a host never answering does not cost one either', () => {
  assert.match(sweep, /pass_purchase_id/, 'the expiry sweep does not select the pass purchase');
  assert.match(sweep, /rpc\/restore_pass_credit/, 'an expired pass request eats the credit');
  // Restore BEFORE marking expired, same rule as releasing the authorisation:
  // if the restore fails the row is left for the next run.
  const loop = sweep.slice(sweep.indexOf('for (const b of due)'));
  assert.ok(loop.indexOf('restore_pass_credit') < loop.indexOf("status: 'expired'"),
    'the booking is marked expired before the credit is restored');
});

console.log(`\n  ${passed} checks passed\n`);
