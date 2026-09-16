// Sending a push, and cleaning up after one that cannot be delivered.
//
// THE PART THAT IS EASY TO GET WRONG IS NOT THE SEND. It is what happens after
// a failure. A push service answers 404 or 410 when a subscription is gone for
// good — the browser was uninstalled, the permission revoked, the endpoint
// retired. Keep sending to it and every message costs a request and gets the
// same answer forever, and the send list slowly fills with addresses that can
// never receive anything. So a 404/410 marks the row expired, here, on the
// way past. Any other failure (429, 500, a timeout) is left alone: those are
// temporary and expiring on them would throw away a live subscriber.
//
// KEYS. VAPID_PRIVATE_KEY signs the send and exists only in this environment.
// VAPID_PUBLIC_KEY is the same key the browser subscribed with — if the pair
// does not match what the subscription was created with, every send comes back
// 403 and nothing anywhere says why. See docs/push.md.
//
// The subject has to be a mailto: or https: URL identifying the sender; push
// services use it to get in touch about a misbehaving sender.
import webpush from 'web-push';

const URL_ = () => process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE = () => process.env.SUPABASE_SERVICE_ROLE_KEY;

/** Whether this deployment can send a push at all. */
export const pushConfigured = () =>
  Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && URL_() && SERVICE());

let ready = false;
/**
 * Returns false when the keys are set but unusable.
 *
 * setVapidDetails VALIDATES: a truncated or mistyped key throws here rather
 * than failing at send time. That throw must not escape — the callers are cron
 * sweeps and booking handlers that have already done the work that matters, and
 * a bad environment variable is not a reason to fail a booking.
 */
const configure = () => {
  if (ready) return true;
  try {
    webpush.setVapidDetails(
      process.env.VAPID_SUBJECT || 'mailto:hello@parkeasy.uk',
      process.env.VAPID_PUBLIC_KEY,
      process.env.VAPID_PRIVATE_KEY,
    );
    ready = true;
    return true;
  } catch (e) {
    // Loud, because every notification this deployment ever sends is broken
    // until somebody fixes the variable.
    console.error('push: VAPID keys are set but invalid —', e?.message);
    return false;
  }
};

const svcHeaders = () => ({
  Authorization: `Bearer ${SERVICE()}`,
  apikey: SERVICE(),
  'Content-Type': 'application/json',
});

/**
 * The live subscriptions for a set of users and/or sessions.
 *
 * Reads with the service key because the table is deliberately unreadable by
 * anybody else — it is a send list, and a driver has no reason to see it.
 */
export async function subscriptionsFor({ userIds = [], sessionIds = [] } = {}) {
  if (!URL_() || !SERVICE()) return [];
  const ors = [];
  if (userIds.length) ors.push(`user_id.in.(${userIds.join(',')})`);
  if (sessionIds.length) ors.push(`session_id.in.(${sessionIds.join(',')})`);
  if (!ors.length) return [];

  const q = new URLSearchParams({
    select: 'endpoint,p256dh,auth,user_id,session_id',
    expired_at: 'is.null',
    or: `(${ors.join(',')})`,
  });
  const r = await fetch(`${URL_()}/rest/v1/push_subscriptions?${q}`, { headers: svcHeaders() });
  if (!r.ok) return [];
  return await r.json();
}

/** Mark endpoints gone, so nothing tries them again. */
export async function expireEndpoints(endpoints) {
  if (!endpoints.length || !URL_() || !SERVICE()) return;
  // One request for the whole batch: a sweep over a few thousand stale
  // subscriptions should not be a few thousand round trips.
  const list = endpoints.map(e => `"${e.replace(/"/g, '\\"')}"`).join(',');
  await fetch(`${URL_()}/rest/v1/push_subscriptions?endpoint=in.(${encodeURIComponent(list)})`, {
    method: 'PATCH',
    headers: { ...svcHeaders(), Prefer: 'return=minimal' },
    body: JSON.stringify({ expired_at: new Date().toISOString() }),
  }).catch(() => {});
}

/**
 * Send one payload to many subscriptions.
 *
 * @param subs     rows from subscriptionsFor()
 * @param payload  { title, body, url, tag, requireInteraction }
 * @returns { sent, failed, expired }
 *
 * Never throws. A notification is not worth failing a booking over, so every
 * caller of this is somewhere that has already done the important work.
 */
export async function sendPush(subs, payload, { ttl = 3600, send } = {}) {
  if (!pushConfigured() || !subs?.length) return { sent: 0, failed: 0, expired: 0 };
  if (!configure()) return { sent: 0, failed: 0, expired: 0 };

  // The payload is JSON the service worker reads. Trimmed here rather than in
  // the worker: a push service rejects a body over ~4KB outright, and the
  // failure looks like a delivery problem rather than an over-long string.
  const body = JSON.stringify({
    title: String(payload?.title || 'ParkEasy').slice(0, 80),
    body: String(payload?.body || '').slice(0, 200),
    url: typeof payload?.url === 'string' && payload.url.startsWith('/') ? payload.url : '/',
    tag: String(payload?.tag || 'parkeasy').slice(0, 60),
    requireInteraction: Boolean(payload?.requireInteraction),
  });

  const gone = [];
  let sent = 0, failed = 0;

  // The one seam in this file. web-push talks HTTPS to a real push service and
  // there is no such thing as a local one, so the only way to test what THIS
  // code does with a 410 — the branch that decides whether a subscriber is
  // thrown away — is to be able to hand it a sender. Production never passes
  // one; encryption and delivery stay web-push's problem, and which status code
  // means "gone for good" stays ours.
  const post = send || ((sub, b, opts) => webpush.sendNotification(sub, b, opts));

  // Serial rather than Promise.all: a Vercel function has one small event loop
  // and a thousand simultaneous TLS handshakes is how a send turns into a
  // timeout. The sweeps that use this run on a cron with nobody waiting.
  for (const s of subs) {
    try {
      await post(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        body,
        { TTL: ttl },
      );
      sent++;
    } catch (e) {
      const code = e?.statusCode;
      if (code === 404 || code === 410) gone.push(s.endpoint);
      else failed++;
    }
  }

  await expireEndpoints(gone);
  return { sent, failed, expired: gone.length };
}

/** The common case: tell these accounts something. */
export async function pushToUsers(userIds, payload, opts) {
  const subs = await subscriptionsFor({ userIds });
  return sendPush(subs, payload, opts);
}

/** The guest case: tell these browsing sessions something. */
export async function pushToSessions(sessionIds, payload, opts) {
  const subs = await subscriptionsFor({ sessionIds });
  return sendPush(subs, payload, opts);
}
