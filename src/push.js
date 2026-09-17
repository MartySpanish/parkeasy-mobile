// Web push: asking once, storing the subscription, and turning it off.
//
// WHY THIS EXISTS. Everything ParkEasy wants to tell a driver happens after
// they have closed the tab: your booking starts in twenty minutes, your meter
// runs out at three, a space opened two streets from where you looked. Email is
// the only channel today, and an email about a car park two streets away is
// read tomorrow.
//
// THE ONE RULE ABOUT THE PERMISSION PROMPT. It is never fired on page load.
// A browser gives a site exactly one chance at that prompt — "Block" is
// permanent, cannot be undone from inside the page, and takes the channel away
// for good. So requestPush() is only ever called from a tap on something that
// obviously wants a notification ("remind me when my time is up"), where the
// answer is already yes. enablePush() below refuses to prompt otherwise, and
// that refusal is the feature, not a limitation.
//
// EVERY FUNCTION HERE IS SAFE TO CALL ANYWHERE. No service worker, no Push API,
// iOS Safari without the app installed, permission already denied, no VAPID key
// configured — each one returns a reason instead of throwing, because the
// caller is a button in a parking app and not an error handler.

import { supabase, isSupabaseEnabled } from './supabase';
import { sessionId } from './analytics';
import { urlBase64ToUint8Array, supportReason } from './pushCore';

/**
 * The VAPID public key, from the environment.
 *
 * Public by nature — it ships in the bundle and is sent to the push service on
 * every subscribe. The PRIVATE half signs the send and lives only in the
 * Vercel function environment; if it ever appears in this file, the channel is
 * compromised. See docs/push.md.
 */
const vapidKey = () => {
  try { return import.meta.env?.VITE_VAPID_PUBLIC_KEY || ''; } catch { return ''; }
};


/**
 * Whether this browser could do push at all, and if not, why.
 *
 * Reads the browser; supportReason() in pushCore.js makes the decision, so the
 * decision can be tested without a browser.
 */
export const pushSupport = () => {
  try {
    return supportReason({
      hasWindow: typeof window !== 'undefined',
      hasServiceWorker: typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
      hasPushManager: typeof window !== 'undefined' && 'PushManager' in window,
      hasNotification: typeof window !== 'undefined' && 'Notification' in window,
      permission: typeof Notification !== 'undefined' ? Notification.permission : undefined,
      vapidKey: vapidKey(),
    });
  } catch {
    return { ok: false, reason: 'no-window' };
  }
};

/** True when this browser already has a live subscription with us. */
export const isPushEnabled = async () => {
  try {
    if (!pushSupport().ok && Notification?.permission !== 'granted') return false;
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return false;
    return Boolean(await reg.pushManager.getSubscription());
  } catch { return false; }
};

/**
 * Ask for permission, subscribe, and store it. Returns { ok, reason }.
 *
 * @param opts.userGesture  must be true. The guard is here rather than at the
 *   call site because the cost of getting it wrong is permanent: a prompt fired
 *   without a gesture is the prompt a driver blocks, and blocking cannot be
 *   undone from inside the page.
 */
export const enablePush = async ({ userGesture = false } = {}) => {
  const support = pushSupport();
  if (!support.ok) return { ok: false, reason: support.reason };
  if (!userGesture && Notification.permission !== 'granted') {
    return { ok: false, reason: 'needs-gesture' };
  }

  try {
    const permission = Notification.permission === 'granted'
      ? 'granted'
      : await Notification.requestPermission();
    if (permission !== 'granted') return { ok: false, reason: permission };

    const reg = await navigator.serviceWorker.ready;
    // An existing subscription is reused rather than replaced: unsubscribing to
    // re-subscribe issues a NEW endpoint, which leaves the old row in the send
    // list and the browser getting two of everything until it expires.
    const sub = await reg.pushManager.getSubscription()
      || await reg.pushManager.subscribe({
        // Chrome refuses a subscription without this, and a silent push is
        // a background-tracking primitive we have no use for anyway.
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidKey()),
      });

    const stored = await savePushSubscription(sub);
    if (!stored) return { ok: false, reason: 'not-stored' };
    return { ok: true, reason: 'granted' };
  } catch (e) {
    return { ok: false, reason: 'failed', error: e?.message };
  }
};

/**
 * Store (or refresh) a subscription in the database.
 *
 * Called on every enablePush, including when the subscription already existed —
 * a push service rotates an endpoint whenever it likes and expires one that has
 * not been seen, so "already subscribed" still has to write.
 */
export const savePushSubscription = async (sub) => {
  try {
    if (!sub || !isSupabaseEnabled || !supabase) return false;
    const json = typeof sub.toJSON === 'function' ? sub.toJSON() : sub;
    const keys = json?.keys || {};
    if (!json?.endpoint || !keys.p256dh || !keys.auth) return false;

    const { data, error } = await supabase.rpc('save_push_subscription', {
      p_endpoint: json.endpoint,
      p_p256dh: keys.p256dh,
      p_auth: keys.auth,
      p_session_id: sessionId(),
      p_user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : null,
    });
    // The function returns false for a shape it refuses, which is a real
    // failure the caller should see rather than a thrown error to swallow.
    return !error && data === true;
  } catch { return false; }
};

/**
 * Turn notifications off: unsubscribe the browser AND mark the row expired.
 *
 * Both halves matter. Unsubscribe alone leaves a row we keep sending to, and
 * the push service then returns 410 for every message forever. Expiring the row
 * alone leaves the browser subscribed, so it keeps a permission the driver
 * thinks they revoked.
 */
export const disablePush = async () => {
  let removed = false;
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && await reg.pushManager.getSubscription();
    if (sub) {
      const endpoint = sub.endpoint;
      // Tell the database FIRST. If unsubscribe succeeds and this does not, the
      // endpoint is gone from the browser and can never be un-listed.
      if (isSupabaseEnabled && supabase) {
        await supabase.rpc('remove_push_subscription', { p_endpoint: endpoint })
          .then(() => {}, () => {});
      }
      removed = await sub.unsubscribe();
    }
    return { ok: true, removed };
  } catch (e) {
    return { ok: false, reason: 'failed', error: e?.message };
  }
};

/**
 * Refresh an existing subscription on app start. Never prompts.
 *
 * A subscription the browser still holds can be missing from our table — the
 * endpoint rotated, or the row was expired after a 410 — and the only symptom
 * is silence. Cheap enough to run on every load, and it cannot ask for anything.
 */
export const refreshPushSubscription = async () => {
  try {
    if (Notification?.permission !== 'granted') return false;
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg && await reg.pushManager.getSubscription();
    if (!sub) return false;
    return await savePushSubscription(sub);
  } catch { return false; }
};
