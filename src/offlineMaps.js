// Telling the service worker whether this driver has offline maps.
//
// The worker cannot check entitlement for itself: Premium lives in
// promo_redemptions behind the Supabase anon key, which is in the app bundle
// and not in the worker. So the page is the authority and posts the answer.
//
// POSTED ON EVERY LOAD AND ON EVERY CHANGE, because `tilesOn` in the worker is
// a plain variable in memory. A worker is stopped and restarted by the browser
// whenever it feels like it, and it comes back with tilesOn = false — which is
// the right default (cache nothing until told) and the reason this cannot be
// set once and forgotten.

const post = (msg) => {
  try {
    const sw = navigator?.serviceWorker;
    // controller is the worker actually handling this page's requests. On the
    // very first load there is none yet — the worker is installing — so the
    // ready promise is used as well, and both are harmless together.
    if (sw?.controller) sw.controller.postMessage(msg);
    else sw?.ready?.then(reg => reg.active?.postMessage(msg)).catch(() => {});
    return true;
  } catch { return false; }
};

/** Switch tile caching on or off for this browser. */
export const setOfflineMaps = (on) => post({ type: 'offline-maps', on: Boolean(on) });

/**
 * Throw away the stored map.
 *
 * "Stop storing maps on my phone" has to actually delete them, not just stop
 * adding more — otherwise turning it off leaves however many megabytes were
 * already there with no way to get rid of them short of clearing site data.
 */
export const clearOfflineMaps = () => post({ type: 'offline-maps-clear' });
