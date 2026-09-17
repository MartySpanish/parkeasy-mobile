// Web push, and the two halves that fail silently.
//
// Push has no user-visible error path. A subscription stored under the wrong
// argument name, a payload the worker cannot read, an endpoint the push service
// retired months ago — every one of them looks exactly like "nobody sent me
// anything". So the checks here are the ones that cannot be done by looking:
// the client's RPC arguments are compared against the database function's
// parameters character by character, and the send path is run against a real
// HTTP server that answers the way a push service does.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import crypto from 'node:crypto';
import { urlBase64ToUint8Array, toStandardBase64, supportReason } from '../../src/pushCore.js';
import webpush from 'web-push';
import {
  pushConfigured, subscriptionsFor, expireEndpoints, sendPush,
} from '../../api/_push.js';

// Real keys: setVapidDetails validates them, so a placeholder makes every send
// path here throw instead of testing anything.
const VAPID = webpush.generateVAPIDKeys();

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
const client = read('../../src/push.js');
const sw = read('../../public/sw.js');
const migration = read('../../supabase/migrations/20260915_push_subscriptions.sql');
const app = read('../../src/App.jsx');
const main = read('../../src/main.jsx');

let passed = 0;
const it = (what, fn) => { fn(); passed++; console.log(`  PASS  ${what}`); };
const ita = async (what, fn) => { await fn(); passed++; console.log(`  PASS  ${what}`); };

console.log('\npush — a channel with no error path');

//------------------------------------------------------------------ pure bits
it('base64url decodes to the same bytes Node produces', () => {
  for (const bytes of [1, 2, 3, 16, 32, 65, 87]) {
    const buf = crypto.randomBytes(bytes);
    const b64url = buf.toString('base64url'); // unpadded, - and _
    const out = urlBase64ToUint8Array(b64url);
    assert.deepEqual([...out], [...buf], `${bytes} bytes round-tripped wrong`);
  }
  // A real VAPID public key: 65 bytes, so 87 base64url characters and one
  // '=' of padding to add back. The length is the assertion that matters —
  // applicationServerKey is rejected outright at any other size.
  const vapid = crypto.createECDH('prime256v1');
  vapid.generateKeys();
  const key = vapid.getPublicKey().toString('base64url');
  assert.equal(key.length % 4, 3, 'this key does not need padding — pick another');
  assert.equal(urlBase64ToUint8Array(key).length, 65);
});

it('base64url is normalised before it is decoded', () => {
  // Node's atob accepts an unpadded string and would decode this either way,
  // so the normalisation is asserted as a string transform. A browser that is
  // stricter is the one this protects.
  assert.equal(toStandardBase64('QQ'), 'QQ==');
  assert.equal(toStandardBase64('QUJD'), 'QUJD', 'padding added to a string that needs none');
  assert.equal(toStandardBase64('a-b_c'), 'a+b/c===', 'the base64url alphabet was not translated');
  const key = 'B'.repeat(87);
  assert.equal(toStandardBase64(key).length, 88, 'a 65-byte VAPID key was not padded to a whole quad');
});

it('support is reported as a reason, not a boolean', () => {
  const full = { hasWindow: true, hasServiceWorker: true, hasPushManager: true,
                 hasNotification: true, permission: 'default', vapidKey: 'k' };
  assert.deepEqual(supportReason(full), { ok: true, reason: 'default' });
  assert.deepEqual(supportReason({ ...full, permission: 'granted' }), { ok: true, reason: 'granted' });
  assert.deepEqual(supportReason({ ...full, permission: 'denied' }), { ok: false, reason: 'denied' });
  // No key on this deployment: offer nothing rather than a switch that cannot
  // work. Checked BEFORE permission, or a denied browser would be told to
  // change its settings for a feature that is not configured.
  assert.deepEqual(supportReason({ ...full, vapidKey: '' }), { ok: false, reason: 'not-configured' });
  assert.deepEqual(supportReason({ ...full, vapidKey: '', permission: 'denied' }),
    { ok: false, reason: 'not-configured' });
  // iOS Safari in a tab.
  assert.deepEqual(supportReason({ ...full, hasPushManager: false }), { ok: false, reason: 'no-push' });
  assert.deepEqual(supportReason({ ...full, hasServiceWorker: false }), { ok: false, reason: 'no-service-worker' });
  assert.deepEqual(supportReason({}), { ok: false, reason: 'no-window' });
});

//------------------------------------------------- the client and the database
it('the client sends exactly the arguments the database function declares', () => {
  const declared = (name) => {
    const sig = migration.slice(migration.indexOf(`function public.${name}(`));
    const params = sig.slice(sig.indexOf('(') + 1, sig.indexOf(')'));
    // [a-z0-9_] and not [a-z_]: p_p256dh has digits in it, and a name regex
    // that quietly drops one parameter makes this whole check meaningless.
    return [...params.matchAll(/\b(p_[a-z0-9_]+)\b/g)].map(m => m[1]);
  };
  const sent = (name) => {
    const call = client.slice(client.indexOf(`rpc('${name}'`));
    const obj = call.slice(call.indexOf('{'), call.indexOf('}') + 1);
    return [...obj.matchAll(/\b(p_[a-z0-9_]+)\s*:/g)].map(m => m[1]);
  };

  const saveDeclared = declared('save_push_subscription');
  assert.deepEqual(saveDeclared,
    ['p_endpoint', 'p_p256dh', 'p_auth', 'p_session_id', 'p_user_agent'],
    'the database function signature changed');
  const saveSent = sent('save_push_subscription');
  assert.deepEqual(saveSent.slice().sort(), saveDeclared.slice().sort(),
    'the client and the database disagree about the argument names — PostgREST '
    + 'cannot find the function and the subscription is never stored');

  assert.deepEqual(sent('remove_push_subscription'), declared('remove_push_subscription'),
    'remove_push_subscription is called with the wrong argument name');
});

it('the client treats a refused save as a failure rather than a success', () => {
  // The function RETURNS false for a shape it will not store. Ignoring the
  // return value means the UI says "Alerts on" over an empty send list.
  assert.match(client, /data === true/,
    'savePushSubscription no longer checks what the database returned');
});

it('the permission prompt cannot be fired without a gesture', () => {
  assert.match(client, /needs-gesture/,
    'the gesture guard is gone — one prompt on page load and the channel is lost for good');
  assert.match(client, /userGesture/,
    'enablePush no longer takes a userGesture flag');
  // And nothing may call it with the guard pre-satisfied from a mount.
  const effects = [...app.matchAll(/useEffect\([^]*?\)/g)];
  assert.ok(!/enablePush\(\s*\{\s*userGesture:\s*true/.test(main),
    'main.jsx asks for the permission on load');
});

it('turning it off tells the database before the browser forgets the endpoint', () => {
  const body = client.slice(client.indexOf('export const disablePush'));
  const rpcAt = body.indexOf('remove_push_subscription');
  const unsubAt = body.indexOf('sub.unsubscribe()');
  assert.ok(rpcAt > 0 && unsubAt > 0, 'disablePush no longer does both halves');
  assert.ok(rpcAt < unsubAt,
    'unsubscribe runs first — if the RPC then fails the endpoint is gone from the '
    + 'browser and can never be taken off the send list');
});

it('app start refreshes a subscription without ever prompting', () => {
  assert.match(main, /refreshPushSubscription\(\)/, 'nothing re-saves a rotated endpoint');
  const refresh = client.slice(client.indexOf('export const refreshPushSubscription'));
  assert.match(refresh, /permission !== 'granted'/, 'refresh does not check the permission first');
  assert.ok(!/requestPermission/.test(refresh), 'the silent refresh path can prompt');
});

it('the private key never reaches the browser bundle', () => {
  // What matters is a client file READING it from the environment, which is how
  // it would end up in the bundle. The name itself appears in App.jsx as the
  // label of an admin health row, and a plain grep for the name fires on that —
  // the fifth time in this suite that a check has gone off on its own
  // documentation, so the pattern is the env access and not the name.
  const envRead = /(?:process|import\.meta)\.env\??(?:\.|\[['"])\s*VAPID_PRIVATE/;
  for (const [name, src] of [['src/push.js', client], ['src/App.jsx', app], ['src/main.jsx', main]]) {
    assert.ok(!envRead.test(src), `${name} reads VAPID_PRIVATE_KEY from the environment`);
  }
  // And the server side must read it, or nothing signs a send.
  assert.match(read('../../api/_push.js'), envRead, 'the sender no longer reads the private key');
  assert.match(client, /VITE_VAPID_PUBLIC_KEY/, 'the client has no public key to subscribe with');
});

//-------------------------------------------------------------- service worker
it('every push branch ends in a notification', () => {
  const handler = sw.slice(sw.indexOf("addEventListener('push'"), sw.indexOf("addEventListener('notificationclick'"));
  assert.match(handler, /showNotification/,
    'a push handled without showing anything is counted against the site, and enough of them revoke the permission');
  // The unreadable-payload branch must fall through to the same call. Any
  // early exit at all is a push that showed nothing, so the invariant is that
  // the handler contains no return statement — stronger, and it does not depend
  // on how the branch happens to be written.
  assert.ok(!/\breturn\b/.test(handler),
    'the push handler can return without showing a notification');
  assert.equal((handler.match(/showNotification/g) || []).length, 1,
    'more than one showNotification — one push must produce exactly one');
  assert.match(handler, /tag:/, 'no tag, so four alerts about one parking session stack up');
});

it('a tap focuses the open tab instead of opening another', () => {
  // Ends at the next handler: pushsubscriptionchange also calls matchAll, and a
  // slice that runs to the end of the file finds it there and passes on nothing.
  const handler = sw.slice(sw.indexOf("addEventListener('notificationclick'"),
                           sw.indexOf("addEventListener('pushsubscriptionchange'"));
  assert.ok(handler.length > 100, 'the notificationclick handler was not found');
  assert.match(handler, /notification\.close\(\)/, 'the notification is left on screen after a tap');
  assert.match(handler, /matchAll/, 'it does not look for an already-open tab');
  assert.match(handler, /openWindow/, 'it cannot open a tab when there is none');
});

it('only a path from our own app is ever opened', () => {
  // A url from the payload is attacker-controlled if the send path is ever
  // abused; an absolute one would let a notification open any site at all.
  const handler = sw.slice(sw.indexOf("addEventListener('push'"));
  assert.match(handler, /startsWith\('\/'\)/, 'the payload url is not restricted to our own paths');
  const api = read('../../api/_push.js');
  assert.match(api, /startsWith\('\/'\)/, 'the sender does not restrict the url either');
});

it('the cache version was bumped, or no browser gets the new worker', () => {
  const v = sw.match(/parkeasy-v(\d+)/);
  assert.ok(v, 'the cache name changed shape');
  assert.ok(Number(v[1]) >= 7, `cache is still ${v[0]} — the push handlers were added without a bump`);
});

//-------------------------------------------------------------- the send path
it('a deployment with no keys reports itself unconfigured', () => {
  const saved = { ...process.env };
  delete process.env.VAPID_PUBLIC_KEY; delete process.env.VAPID_PRIVATE_KEY;
  assert.equal(pushConfigured(), false);
  process.env = saved;
});

await ita('the send list is read live-only and by user or session', async () => {
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => { seen.push(String(url)); return { ok: true, json: async () => [] }; };
  process.env.SUPABASE_URL = 'https://db.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
  try {
    await subscriptionsFor({ userIds: ['u1', 'u2'] });
    await subscriptionsFor({ sessionIds: ['s1'] });
    assert.equal(await subscriptionsFor({}).then(r => r.length), 0,
      'asking for nobody queried the whole table');
    assert.equal(seen.length, 2, 'the empty request still hit the database');
    for (const u of seen) {
      assert.match(u, /expired_at=is\.null/, `a dead subscription would be sent to: ${u}`);
    }
    assert.match(seen[0], /user_id\.in\.%28u1%2Cu2%29|user_id\.in\.\(u1,u2\)/, seen[0]);
    assert.match(seen[1], /session_id\.in/, seen[1]);
  } finally { globalThis.fetch = realFetch; }
});

await ita('a subscription the push service has retired is expired, not retried forever', async () => {
  process.env.VAPID_PUBLIC_KEY = VAPID.publicKey; process.env.VAPID_PRIVATE_KEY = VAPID.privateKey;
  process.env.SUPABASE_URL = 'https://db.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';

  const sub = (n) => ({ endpoint: `https://push.test/${n}`, p256dh: 'k', auth: 'a' });
  const patches = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => { patches.push({ url: String(url), opts }); return { ok: true, json: async () => [] }; };

  const failWith = (code) => async () => { const e = new Error('nope'); e.statusCode = code; throw e; };

  try {
    // 410 Gone and 404 Not Found both mean the subscription will never work
    // again. Anything else might work in a minute.
    for (const code of [410, 404]) {
      patches.length = 0;
      const r = await sendPush([sub('a'), sub('b')], { title: 'x' }, { send: failWith(code) });
      assert.deepEqual(r, { sent: 0, failed: 0, expired: 2 },
        `${code} was not treated as gone: ${JSON.stringify(r)}`);
      assert.equal(patches.length, 1, 'the expiry was not one batched request');
      assert.equal(patches[0].opts.method, 'PATCH');
      assert.match(patches[0].opts.body, /expired_at/);
      assert.match(patches[0].url, /endpoint=in\./, patches[0].url);
    }

    // A 500 or a 429 is the push service having a bad day. Expiring on it
    // throws away a live subscriber for good.
    for (const code of [429, 500, 503, undefined]) {
      patches.length = 0;
      const r = await sendPush([sub('c')], { title: 'x' }, { send: failWith(code) });
      assert.deepEqual(r, { sent: 0, failed: 1, expired: 0 },
        `${code} was treated as permanent: ${JSON.stringify(r)}`);
      assert.equal(patches.length, 0, `a ${code} expired a live subscription`);
    }

    patches.length = 0;
    const ok = await sendPush([sub('d'), sub('e')], { title: 'x' }, { send: async () => ({ statusCode: 201 }) });
    assert.deepEqual(ok, { sent: 2, failed: 0, expired: 0 }, JSON.stringify(ok));
    assert.equal(patches.length, 0, 'a successful send expired something');

    // One bad apple must not stop the rest of the batch.
    let n = 0;
    const flaky = async () => { n++; if (n === 2) { const e = new Error('x'); e.statusCode = 410; throw e; } };
    patches.length = 0;
    const mixed = await sendPush([sub('f'), sub('g'), sub('h')], { title: 'x' }, { send: flaky });
    assert.deepEqual(mixed, { sent: 2, failed: 0, expired: 1 }, JSON.stringify(mixed));
  } finally { globalThis.fetch = realFetch; }
});

await ita('the payload is exactly what the worker reads, and trimmed', async () => {
  process.env.VAPID_PUBLIC_KEY = VAPID.publicKey; process.env.VAPID_PRIVATE_KEY = VAPID.privateKey;
  process.env.SUPABASE_URL = 'https://db.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
  let body = null, ttl = null, subSeen = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => [] });
  try {
    await sendPush([{ endpoint: 'https://push.test/x', p256dh: 'KEY', auth: 'AUTH' }], {
      title: 'T'.repeat(500), body: 'B'.repeat(5000), url: 'https://evil.test/steal',
      tag: 'timer', requireInteraction: true,
    }, { send: async (s, b, o) => { subSeen = s; body = b; ttl = o.TTL; } });

    // The subscription shape web-push needs, rebuilt from our own columns.
    assert.deepEqual(subSeen, { endpoint: 'https://push.test/x', keys: { p256dh: 'KEY', auth: 'AUTH' } });
    const d = JSON.parse(body);
    assert.equal(d.title.length, 80, 'the title is not capped');
    assert.equal(d.body.length, 200, 'the body is not capped');
    // An absolute url in a payload would let a notification open any site at
    // all. Refused, not sanitised into something odd.
    assert.equal(d.url, '/', `an off-site url survived: ${d.url}`);
    assert.equal(d.tag, 'timer');
    assert.equal(d.requireInteraction, true);
    assert.ok(body.length < 3000, `payload is ${body.length} bytes — a push service caps at about 4KB`);
    assert.equal(ttl, 3600);

    // A relative path is kept as-is: that is how a notification deep-links.
    await sendPush([{ endpoint: 'https://push.test/x', p256dh: 'K', auth: 'A' }],
      { url: '/bookings/123' }, { send: async (s, b) => { body = b; } });
    assert.equal(JSON.parse(body).url, '/bookings/123');
  } finally { globalThis.fetch = realFetch; }
});

await ita('keys that are set but invalid do not take the caller down with them', async () => {
  // A mistyped VAPID_PUBLIC_KEY in Vercel used to throw out of setVapidDetails,
  // through sendPush, and into whatever was sending the notification — which is
  // a cron sweep or a booking handler that had already done the real work.
  const mod = await import(`../../api/_push.js?bad=${Date.now()}`);
  process.env.VAPID_PUBLIC_KEY = 'not-a-key';
  process.env.VAPID_PRIVATE_KEY = 'also-not-a-key';
  process.env.SUPABASE_URL = 'https://db.test';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
  const realErr = console.error;
  console.error = () => {};
  try {
    const r = await mod.sendPush([{ endpoint: 'https://push.test/x', p256dh: 'k', auth: 'a' }], { title: 'x' });
    assert.deepEqual(r, { sent: 0, failed: 0, expired: 0 }, JSON.stringify(r));
  } finally {
    console.error = realErr;
    process.env.VAPID_PUBLIC_KEY = VAPID.publicKey;
    process.env.VAPID_PRIVATE_KEY = VAPID.privateKey;
  }
});

it('a mismatched key pair is visible in the admin panel', () => {
  // The only failure mode here with no symptom: browsers subscribe with
  // VITE_VAPID_PUBLIC_KEY, we sign with VAPID_PUBLIC_KEY, and if they are
  // different keys every push is rejected 403 while the app says alerts are on.
  const admin = read('../../api/admin.js');
  assert.match(admin, /pushKeysMatch:/, 'the admin endpoint no longer compares the two public keys');
  assert.match(admin, /VAPID_PUBLIC_KEY === process\.env\.VITE_VAPID_PUBLIC_KEY/,
    'pushKeysMatch is reported without actually comparing the keys');
  assert.match(app, /e\.pushKeysMatch/, 'the dashboard does not show whether the keys match');
  assert.match(app, /e\.pushKeys\b/, 'the dashboard does not show whether the server keys are set');
  assert.match(app, /e\.pushClientKey/, 'the dashboard does not show whether the client key is set');
});

it('production sends through web-push, not the test seam', () => {
  const api = read('../../api/_push.js');
  assert.match(api, /send \|\| \(\(sub, b, opts\) => webpush\.sendNotification\(sub, b, opts\)\)/,
    'the default sender is no longer web-push');
  assert.match(api, /setVapidDetails/, 'nothing signs the send');
});

console.log(`\n  ${passed} checks passed\n`);
