// The two pieces of push logic that are worth testing on their own.
//
// A separate module for one reason: src/push.js imports ./supabase and
// ./analytics, which only Vite can resolve, so nothing in it can be imported by
// a plain Node test — the rest of this suite falls back to asserting on source
// text for files like that. These two are the ones where source text is not
// good enough:
//
//   urlBase64ToUint8Array  is bit-twiddling. Get it wrong and subscribe()
//                          throws for every browser, and "it looks right" is
//                          not a check.
//   supportReason          is a five-way decision that drives what the UI
//                          says. The wrong branch either hides a working
//                          feature or offers a dead switch.
//
// Both are pure, so both get exercised for real.

/**
 * base64url → standard, padded base64.
 *
 * Its own function because it is the half a test can actually pin down. Node's
 * atob is lenient about both the alphabet's absence of padding and — as it
 * turns out — accepts unpadded input, so a decode test cannot tell whether the
 * padding line is there. Browsers are not all so forgiving, and a VAPID key is
 * 65 bytes, which is exactly the length that needs a pad character adding back.
 */
export const toStandardBase64 = (base64) =>
  (base64 + '='.repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, '+').replace(/_/g, '/');

/**
 * base64url → Uint8Array, which is the only form applicationServerKey takes.
 *
 * VAPID keys are base64url (- and _ instead of + and /) and usually unpadded;
 * atob is specified for neither, so both are undone first.
 */
export const urlBase64ToUint8Array = (base64) => {
  const raw = atob(toStandardBase64(base64));
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
};

/**
 * Why push is or is not available, from what the browser has.
 *
 * The caller needs three different outcomes, not a boolean:
 *   ok               → offer the control
 *   'no-push' etc.   → it could work, but not in this browser as it stands
 *                      (iOS Safari in a tab: installing the PWA fixes it)
 *   'denied'         → already blocked, and we may never ask again
 *   'not-configured' → this deployment has no VAPID key; offer nothing
 *
 * @param caps { hasWindow, hasServiceWorker, hasPushManager, hasNotification,
 *               permission, vapidKey }
 */
export const supportReason = (caps = {}) => {
  if (!caps.hasWindow) return { ok: false, reason: 'no-window' };
  if (!caps.hasServiceWorker) return { ok: false, reason: 'no-service-worker' };
  if (!caps.hasPushManager) return { ok: false, reason: 'no-push' };
  if (!caps.hasNotification) return { ok: false, reason: 'no-notification' };
  if (!caps.vapidKey) return { ok: false, reason: 'not-configured' };
  if (caps.permission === 'denied') return { ok: false, reason: 'denied' };
  return { ok: true, reason: caps.permission || 'default' };
};
