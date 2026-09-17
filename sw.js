const CACHE = 'parkeasy-v8';
const BASE = '/';

// ---------------------------------------------------------------------------
// OFFLINE MAPS — the thing the paywall has been selling.
//
// The pricing sheet has listed "Offline maps — works without signal" as a
// Premium benefit for months, and the fetch handler below used to return early
// for every cross-origin request, tiles included. There were no offline maps.
// With no signal the map drew nothing at all.
//
// WHAT IT DOES NOW: the tiles the driver has actually looked at are kept, and
// served from the cache when the network cannot be reached. Not "all of
// Northern Ireland" — nobody downloads 200MB on a phone plan, and promising a
// place they have never opened would be the same lie in a new shape. The useful
// case is the real one: you drove into a basement car park you were looking at
// this morning, there are no bars, and the map still shows where you are.
//
// SEPARATE CACHE, HARD CAP. Tiles are the only thing here that grows without
// limit, so they live in their own cache — which also has to survive a deploy,
// because the activate handler deletes every other cache and would otherwise
// throw the driver's map away every time the app ships.
const TILE_CACHE = 'parkeasy-tiles-v1';
// ~1,200 tiles is 30-60MB at OSM's sizes: several towns at street zoom, or one
// city in detail. Enough to be worth having, small enough not to be a problem
// on a phone.
const TILE_LIMIT = 1200;
// Trimmed in batches, so one tile fetch never turns into 1,200 cache deletes.
const TILE_TRIM = 150;

// Whether this driver is entitled to it. Held in memory and set by the page,
// which knows about Premium; the worker cannot check for itself, because
// entitlement lives behind the Supabase anon key in the app bundle. It starts
// false, so a fresh worker caches nothing until told — and a driver who stops
// paying stops being told.
let tilesOn = false;

const isTile = (url) =>
  /(^|\.)tile\.openstreetmap\.org$/.test(url.hostname)
  || /(^|\.)basemaps\.cartocdn\.com$/.test(url.hostname);

// CACHE FIRST, and for this one thing that is the right way round. A tile at a
// given z/x/y is immutable — the roads do not move — so serving a stored copy
// is not staleness, it is the point. The network is still asked in the
// background, so panning around keeps filling the cache.
async function tileResponse(request) {
  const cache = await caches.open(TILE_CACHE);
  const hit = await cache.match(request);
  if (hit) {
    // Refreshed behind the answer, and its failure never surfaces: the driver
    // already has their tile.
    fetch(request).then(r => { if (r.ok) cache.put(request, r.clone()); }).catch(() => {});
    return hit;
  }
  try {
    const r = await fetch(request);
    // Opaque cross-origin responses (type 'opaque', status 0) are cacheable and
    // ARE what a tile fetch returns without CORS. Checking r.ok alone rejects
    // every one of them and caches precisely nothing.
    if (r && (r.ok || r.type === 'opaque')) {
      await cache.put(request, r.clone());
      trimTiles(cache);
    }
    return r;
  } catch (e) {
    // No signal and no stored tile. The cache was already consulted at the top
    // of this function, so there is nothing else to try: the original error is
    // what comes back and Leaflet draws its blank tile.
    //
    // A second cache.match() here reads as careful and is unreachable, because
    // the hit path returns before the fetch is attempted. The mutation test
    // proved it — deleting it changed no outcome — so it went, rather than
    // sitting here looking like a guarantee.
    throw e;
  }
}

// Oldest first, because Cache.keys() returns insertion order. Not true LRU,
// which would need a timestamp per tile and somewhere to keep it; insertion
// order is close enough — the tiles added longest ago are the places the driver
// has moved on from.
let trimming = false;
async function trimTiles(cache) {
  if (trimming) return;
  trimming = true;
  try {
    const keys = await cache.keys();
    if (keys.length <= TILE_LIMIT) return;
    const over = keys.length - TILE_LIMIT + TILE_TRIM;
    await Promise.all(keys.slice(0, over).map(k => cache.delete(k)));
  } catch { /* a failed trim is not worth breaking a map over */ }
  finally { trimming = false; }
}

// The page says whether offline maps are on, and can ask for the stored map to
// be thrown away — which is what "stop storing maps on my phone" has to mean.
self.addEventListener('message', e => {
  const d = e.data || {};
  if (d.type === 'offline-maps') tilesOn = Boolean(d.on);
  if (d.type === 'offline-maps-clear') {
    e.waitUntil(caches.delete(TILE_CACHE));
    tilesOn = false;
  }
});

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
    // TILE_CACHE is spared. Deleting every cache but the current one is right
    // for the app shell, and would throw away the driver's stored map on every
    // single deploy — the one thing offline maps cannot do.
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE && k !== TILE_CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // GETs only. A POST to Supabase or Stripe answered from a cache is a booking
  // that did not happen reported as one that did, and Cache.put refuses one
  // anyway. Checked before the tile branch, which is the branch that caches.
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // Map tiles, when this driver is entitled to them.
  if (isTile(url)) {
    if (tilesOn) e.respondWith(tileResponse(e.request));
    return;
  }

  const isAppShell = url.origin === self.location.origin;
  if (!isAppShell) return; // fonts and everything else pass through normally

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
