const CACHE = 'parkeasy-v6';
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
