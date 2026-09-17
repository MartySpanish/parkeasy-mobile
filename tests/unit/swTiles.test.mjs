// The offline map, driven for real — the actual public/sw.js, not a copy.
//
// WHY THIS IS NOT A BROWSER TEST. It was meant to be. Playwright's
// context.route does NOT intercept requests made from inside a service worker:
// the page's fetch goes through the worker, the worker's own fetch() bypasses
// routing entirely and hits the network, which this sandbox blocks. The probe
// proved it — playwright saw zero route hits and the worker cached nothing. So
// a browser can confirm the worker installs and takes the message, and nothing
// more.
//
// What it CAN be is the real file, executed. sw.js is a classic script that
// registers handlers on `self`, so a vm context with a fake `self`, a
// Map-backed Cache API and a controllable `fetch` runs the shipped code and
// lets every branch be driven: cached, uncached, offline, over the cap, not
// entitled. Same idea as src/pushCore.js — the logic is tested rather than
// described — except here the file under test needs no rewriting at all.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8');

// ── A Cache API good enough to be wrong in the same places a browser would be.
class FakeCache {
  constructor() { this.store = new Map(); }       // insertion-ordered, like the real one
  async match(req) { return this.store.get(String(req.url ?? req)) || undefined; }
  async put(req, res) { this.store.set(String(req.url ?? req), res); }
  async delete(req) { return this.store.delete(String(req.url ?? req)); }
  // Real Cache.keys() returns Request objects in insertion order, which is
  // exactly what trimTiles() relies on to drop the oldest first.
  async keys() { return [...this.store.keys()].map(url => ({ url })); }
  async addAll() { /* CORE precache; nothing here depends on it */ }
}

/** A worker, loaded and ready to be driven. */
function loadWorker({ fetchImpl } = {}) {
  const caches_ = new Map();
  const listeners = new Map();
  const calls = { fetch: [] };

  const self_ = {
    addEventListener: (type, fn) => {
      // Several handlers per type is legal; the file registers one each.
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    location: { origin: 'https://parkeasy.uk' },
    skipWaiting: async () => {},
    clients: { claim: async () => {}, matchAll: async () => [], openWindow: async () => {} },
    registration: { showNotification: async () => {}, pushManager: { getSubscription: async () => null } },
  };

  const fetch_ = async (req) => {
    const url = String(req.url ?? req);
    calls.fetch.push(url);
    if (fetchImpl) return fetchImpl(url);
    return { ok: true, status: 200, type: 'basic', url, clone() { return { ...this, clone: this.clone }; } };
  };

  const sandbox = {
    self: self_,
    caches: {
      open: async (name) => {
        if (!caches_.has(name)) caches_.set(name, new FakeCache());
        return caches_.get(name);
      },
      keys: async () => [...caches_.keys()],
      delete: async (name) => caches_.delete(name),
      // CacheStorage.match searches EVERY cache, which is what the shell's
      // offline fallback relies on. Stubbing it to undefined made a cache-first
      // rewrite of the shell indistinguishable from network-first, because the
      // lookup always missed and the network always got asked.
      match: async (req) => {
        for (const c of caches_.values()) {
          const hit = await c.match(req);
          if (hit) return hit;
        }
        return undefined;
      },
    },
    fetch: fetch_,
    URL,
    console,
    Promise, Boolean, String, Number, Object, Array, Map, Set, RegExp, Error, TypeError,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);

  const fire = (type, event) => {
    const fns = listeners.get(type) || [];
    assert.ok(fns.length, `sw.js registers no ${type} handler`);
    return Promise.all(fns.map(fn => fn(event)));
  };

  // A FetchEvent, reduced to the two things the handler uses.
  const fetchEvent = (url, method = 'GET') => {
    let responded;
    const waits = [];
    return {
      request: { url, method },
      respondWith: (p) => { responded = p; },
      waitUntil: (p) => waits.push(p),
      get responded() { return responded; },
      get waits() { return waits; },
    };
  };

  return { fire, fetchEvent, caches_, calls, listeners };
}

const TILE = 'https://tile.openstreetmap.org/15/16000/10500.png';
const CARTO = 'https://a.basemaps.cartocdn.com/rastertiles/dark_all/15/16000/10500.png';
const TILE_CACHE = 'parkeasy-tiles-v1';

const tilesOn = async (w) => {
  await w.fire('message', { data: { type: 'offline-maps', on: true }, waitUntil: () => {} });
};

let passed = 0;
const it = async (what, fn) => { await fn(); passed++; console.log(`  PASS  ${what}`); };

console.log('\nswTiles — the offline map, running the shipped worker');

//--------------------------------------------------------- not entitled, no cache
await it('a worker that has not been told caches nothing', async () => {
  // tilesOn starts false and the browser restarts a worker whenever it likes,
  // so this is not an edge case — it is every cold start.
  const w = loadWorker();
  const e = w.fetchEvent(TILE);
  await w.fire('fetch', e);
  assert.equal(e.responded, undefined,
    'the worker answered a tile request before being told the driver is entitled');
  assert.equal(w.caches_.has(TILE_CACHE), false, 'and it opened a tile cache anyway');
});

await it('being told switches it on, and being told again switches it off', async () => {
  const w = loadWorker();
  await tilesOn(w);
  const on = w.fetchEvent(TILE);
  await w.fire('fetch', on);
  assert.ok(on.responded, 'the worker still ignores tiles after being told');
  await on.responded;

  await w.fire('message', { data: { type: 'offline-maps', on: false }, waitUntil: () => {} });
  const off = w.fetchEvent('https://tile.openstreetmap.org/15/1/1.png');
  await w.fire('fetch', off);
  assert.equal(off.responded, undefined, 'a lapsed subscriber keeps caching tiles');
});

//------------------------------------------------------------------ the real path
await it('a tile is fetched once and served from the cache afterwards', async () => {
  const w = loadWorker();
  await tilesOn(w);

  const first = w.fetchEvent(TILE);
  await w.fire('fetch', first);
  const r1 = await first.responded;
  assert.equal(r1.ok, true);
  assert.deepEqual(w.calls.fetch, [TILE], 'the first request did not reach the network');

  const cache = w.caches_.get(TILE_CACHE);
  assert.ok(cache, 'no tile cache was created');
  assert.equal(cache.store.size, 1, 'the tile was not stored');

  // Second time: served from the cache. The network is still asked, in the
  // background, so panning keeps the cache fresh — but the answer does not
  // wait for it.
  const second = w.fetchEvent(TILE);
  await w.fire('fetch', second);
  const r2 = await second.responded;
  assert.ok(r2, 'nothing was served the second time');
  assert.equal(cache.store.size, 1, 'the same tile was stored twice');
});

await it('CARTO tiles are cached too, not just OSM', async () => {
  // Which provider is in use depends on VITE_CARTO_API_KEY (src/mapTiles.js).
  // Caching one of them means half the deployments have no offline maps.
  const w = loadWorker();
  await tilesOn(w);
  const e = w.fetchEvent(CARTO);
  await w.fire('fetch', e);
  assert.ok(e.responded, 'a CARTO tile is not recognised as a tile');
  await e.responded;
  assert.equal(w.caches_.get(TILE_CACHE).store.size, 1);
});

await it('an opaque response is stored — which is what a tile actually is', async () => {
  // A no-CORS tile fetch returns type 'opaque' with status 0, so `if (r.ok)`
  // alone rejects every real tile and caches precisely nothing.
  const w = loadWorker({
    fetchImpl: async (url) => ({ ok: false, status: 0, type: 'opaque', url,
                                 clone() { return { ...this, clone: this.clone }; } }),
  });
  await tilesOn(w);
  const e = w.fetchEvent(TILE);
  await w.fire('fetch', e);
  await e.responded;
  assert.equal(w.caches_.get(TILE_CACHE).store.size, 1,
    'an opaque tile response was not stored, so nothing is ever cached in a real browser');
});

await it('a genuine error response is not stored as a map tile', async () => {
  // A 404 or a captive-portal 302 cached as a tile is a permanent grey square.
  const w = loadWorker({
    fetchImpl: async (url) => ({ ok: false, status: 404, type: 'basic', url,
                                 clone() { return { ...this, clone: this.clone }; } }),
  });
  await tilesOn(w);
  const e = w.fetchEvent(TILE);
  await w.fire('fetch', e);
  await e.responded;
  const cache = w.caches_.get(TILE_CACHE);
  assert.equal(cache ? cache.store.size : 0, 0, 'a 404 was stored as a tile');
});

//---------------------------------------------------------------- with no signal
await it('with no signal, a tile the driver has already seen still arrives', async () => {
  // THE WHOLE POINT. Drive into a basement car park you were looking at this
  // morning: no bars, and the map still shows where you are.
  let online = true;
  const w = loadWorker({
    fetchImpl: async (url) => {
      if (!online) throw new TypeError('Failed to fetch');
      return { ok: true, status: 200, type: 'opaque', url,
               clone() { return { ...this, clone: this.clone }; } };
    },
  });
  await tilesOn(w);

  const warm = w.fetchEvent(TILE);
  await w.fire('fetch', warm);
  await warm.responded;
  assert.equal(w.caches_.get(TILE_CACHE).store.size, 1, 'nothing was cached while online');

  online = false;
  const cold = w.fetchEvent(TILE);
  await w.fire('fetch', cold);
  const r = await cold.responded;
  assert.ok(r, 'with no signal the stored tile was not served — there are no offline maps');
  assert.equal(r.url, TILE);
});

await it('with no signal and nothing stored, the failure is passed on', async () => {
  // Leaflet handles a failed tile by drawing nothing. An exception thrown from
  // somewhere else inside the worker is a harder thing to reason about, so the
  // original error is what comes back.
  const w = loadWorker({ fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
  await tilesOn(w);
  const e = w.fetchEvent(TILE);
  await w.fire('fetch', e);
  await assert.rejects(() => e.responded, /Failed to fetch/,
    'a tile that was never stored resolves to something, or throws something else');
});

//-------------------------------------------------------------------- the cap
await it('the cache is trimmed, oldest first, and stays near the cap', async () => {
  const limit = Number(SRC.match(/const TILE_LIMIT = (\d+);/)[1]);
  const trim = Number(SRC.match(/const TILE_TRIM = (\d+);/)[1]);
  const w = loadWorker();
  await tilesOn(w);

  // Past the cap by more than one trim's worth.
  for (let i = 0; i < limit + trim + 20; i++) {
    const e = w.fetchEvent(`https://tile.openstreetmap.org/15/${i}/10500.png`);
    await w.fire('fetch', e);
    await e.responded;
  }
  const cache = w.caches_.get(TILE_CACHE);
  assert.ok(cache.store.size <= limit + trim,
    `${cache.store.size} tiles stored against a cap of ${limit} — the cache is unbounded`);
  assert.ok(cache.store.size > limit - trim - 50,
    `${cache.store.size} tiles left after trimming to a cap of ${limit} — too much was thrown away`);
  // The oldest went and the newest stayed: the places you have moved on from.
  const urls = [...cache.store.keys()];
  assert.ok(!urls.includes('https://tile.openstreetmap.org/15/0/10500.png'),
    'the first tile ever stored survived, so the newest are being deleted instead');
  assert.ok(urls.includes(`https://tile.openstreetmap.org/15/${limit + trim + 19}/10500.png`),
    'the tile just fetched was trimmed away immediately');
});

//------------------------------------------------------------------- clearing
await it('clearing throws the stored map away and stops refilling it', async () => {
  const w = loadWorker();
  await tilesOn(w);
  const e = w.fetchEvent(TILE);
  await w.fire('fetch', e);
  await e.responded;
  assert.equal(w.caches_.get(TILE_CACHE).store.size, 1);

  const waits = [];
  await w.fire('message', { data: { type: 'offline-maps-clear' }, waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);
  assert.equal(w.caches_.has(TILE_CACHE), false, 'the stored map survived being cleared');

  // And it does not immediately start refilling: clearing turns it off too, so
  // "stop storing maps on my phone" means both halves.
  const after = w.fetchEvent('https://tile.openstreetmap.org/15/1/1.png');
  await w.fire('fetch', after);
  assert.equal(after.responded, undefined, 'clearing left caching switched on');
});

//----------------------------------------------------------------- the rest
await it('a POST is never answered from any cache', async () => {
  // A POST to Supabase or Stripe served from a cache is a booking that did not
  // happen, reported as one that did.
  const w = loadWorker();
  await tilesOn(w);
  const e = w.fetchEvent('https://parkeasy.uk/api/checkout/create-session', 'POST');
  await w.fire('fetch', e);
  assert.equal(e.responded, undefined, 'the worker took responsibility for a POST');
  const tile = w.fetchEvent(TILE, 'POST');
  await w.fire('fetch', tile);
  assert.equal(tile.responded, undefined, 'a POST to a tile host was cached');
});

await it('a deploy does not take the stored map with it', async () => {
  const w = loadWorker();
  await tilesOn(w);
  const e = w.fetchEvent(TILE);
  await w.fire('fetch', e);
  await e.responded;
  // An old app-shell cache, as a previous version would have left behind.
  w.caches_.set('parkeasy-v7', new FakeCache());

  const waits = [];
  await w.fire('activate', { waitUntil: (p) => waits.push(p) });
  await Promise.all(waits);

  assert.equal(w.caches_.has('parkeasy-v7'), false, 'the old app-shell cache was kept');
  assert.equal(w.caches_.has(TILE_CACHE), true,
    'the tile cache was deleted on activate — the stored map lasts until the next deploy');
});

await it('the app shell is still network-first, even when it is cached', async () => {
  // Cache-first for the shell is how "deployed but users see the old version"
  // happens, and that is what the original comment in this file was guarding.
  //
  // THE SHELL CACHE IS PRIMED FIRST. Without that the cache misses either way
  // and the network gets asked whichever order the code is in — which is how
  // the first version of this check passed against a cache-first rewrite.
  const w = loadWorker();
  const url = 'https://parkeasy.uk/index.html';
  const c = new FakeCache();
  c.store.set(url, { ok: true, status: 200, type: 'basic', url, stale: true,
                     clone() { return { ...this, clone: this.clone }; } });
  // The shell cache's name, read out of the file rather than copied, so a
  // version bump does not quietly turn this check off.
  w.caches_.set(SRC.match(/const CACHE = '([^']+)'/)[1], c);

  const e = w.fetchEvent(url);
  await w.fire('fetch', e);
  assert.ok(e.responded, 'the shell is no longer handled at all');
  const r = await e.responded;
  assert.ok(w.calls.fetch.includes(url),
    'a cached shell was served without asking the network — a deploy would never reach anybody');
  assert.ok(!r.stale, 'the stale cached copy was served in preference to the network');
});

console.log(`\n  ${passed} checks passed\n`);
