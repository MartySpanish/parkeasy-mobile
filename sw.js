const CACHE = 'parkeasy-v7';
const BASE = '/';

// Only precache static assets that rarely change. The HTML shell is
// deliberately NOT precached so navigations always fetch the latest build
// (network-first below), preventing "deployed but users see the old version".
const CORE = [
  BASE + 'manifest.json',
  BASE + 'icon.svg',
  BASE + 'icon-192.png',
  BASE + 'icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  const isAppShell = url.origin === self.location.origin;
  if (!isAppShell) return; // OSM tiles, fonts, etc. pass through normally

  // Always go network-first for navigations and hashed assets so a new
  // deploy is picked up immediately; fall back to cache only when offline.
  e.respondWith(
    fetch(e.request)
      .then(r => { const clone = r.clone(); caches.open(CACHE).then(c => c.put(e.request, clone)); return r; })
      .catch(() => caches.match(e.request))
  );
});

// ---------------------------------------------------------------------------
// Push.
//
// A push event MUST show a notification. Chrome subscribes us with
// userVisibleOnly, and a push handled without showing anything is counted
// against the site — enough of them and the browser revokes the permission.
// So every branch below ends in showNotification, including the one where the
// payload is unreadable.
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch {
    // Not JSON. Show the text rather than nothing, because nothing costs the
    // permission.
    try { d = { body: e.data && e.data.text() }; } catch { d = {}; }
  }

  const title = d.title || 'ParkEasy';
  const options = {
    body: d.body || '',
    icon: BASE + 'icon-192.png',
    badge: BASE + 'icon-192.png',
    // The path to open, carried through to notificationclick.
    data: { url: typeof d.url === 'string' && d.url.startsWith('/') ? d.url : BASE },
    // Same tag replaces an earlier notification instead of stacking: four
    // "your time is nearly up" alerts about one parking session is four
    // reasons to switch notifications off.
    tag: d.tag || 'parkeasy',
    renotify: Boolean(d.renotify),
    // A parking timer running out is worth a buzz; a "space opened nearby" is
    // not. The sender decides, and quiet is the default.
    requireInteraction: Boolean(d.requireInteraction),
    silent: Boolean(d.silent),
  };
  e.waitUntil(self.registration.showNotification(title, options));
});

// Tapping it focuses the tab we already have rather than opening a fifth one,
// and navigates that tab to where the notification pointed.
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || BASE;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (new URL(c.url).origin === self.location.origin) {
        await c.focus();
        if ('navigate' in c) { try { await c.navigate(target); } catch { /* focused is enough */ } }
        return;
      }
    }
    await self.clients.openWindow(target);
  })());
});

// The push service can retire a subscription on its own (key rotation, a long
// silence). The browser tells us once, here, and this is the only chance to
// re-register before the driver simply stops hearing from us. The page does the
// database half on its next load; this keeps the browser's own subscription
// alive so there is something to save.
self.addEventListener('pushsubscriptionchange', e => {
  e.waitUntil((async () => {
    try {
      const old = e.oldSubscription || await self.registration.pushManager.getSubscription();
      const key = (e.newSubscription && e.newSubscription.options.applicationServerKey)
        || (old && old.options && old.options.applicationServerKey);
      if (!key) return;
      const sub = e.newSubscription
        || await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      const json = sub.toJSON();
      // Posted to every open page; whichever is listening saves it. Nothing
      // here talks to the database directly — the anon key and the RPC live in
      // the app bundle, not in the worker.
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of all) c.postMessage({ type: 'push-subscription-changed', subscription: json });
    } catch { /* nothing to do from in here */ }
  })());
});
