# Premium, and only selling what is built

## What was being sold

The pricing sheet listed six benefits as a hardcoded array of emoji and strings.
**Two of them were not true.**

> 🗺️ **Offline maps — works without signal**

There were no offline maps. `public/sw.js` returned early for every
cross-origin request, so tiles were never stored and with no signal the map drew
nothing at all. This has been on the paywall for months, at £29/year.

> 🔔 **Notifications when spots free up**

This one exists — `api/cron/notify-waitlist.js` — and is **free to everybody**
who leaves an email. Charging for it is a different kind of untruth from
inventing one, and not much better.

## The fix is structural

`src/premium.js` is the single source of truth. Every claim carries a `proof`:
the identifier in this repository that implements it.

```js
{
  icon: '🗺️',
  text: 'Offline maps — the areas you’ve looked at keep working with no signal',
  tier: 'premium',
  proof: { file: 'public/sw.js', needle: 'TILE_CACHE' },
}
```

`tests/unit/premium.test.mjs` greps for each needle and fails if it is missing.
So a benefit **cannot be listed without something in the codebase behind it**,
and a feature cannot be deleted while the paywall still sells it. `tier` says
who gets it; the test also checks nothing free is sold as Premium, and that no
claim uses "all of", "anywhere", "whole country" or "unlimited".

The waitlist notification stays on the sheet, under a **Free for everyone**
heading, described as free.

## Offline maps, for real

The tiles the driver has **actually looked at** are kept and served when the
network cannot be reached. Not all of Northern Ireland: nobody downloads 200MB
on a phone plan, and promising a place they have never opened would be the same
lie in a new shape. The useful case is the real one — you drive into a basement
car park you were looking at this morning, there are no bars, and the map still
shows where you are. The wording says exactly that.

| Decision | Why |
| --- | --- |
| **Cache first** for tiles | A tile at a given z/x/y is immutable — the roads do not move — so a stored copy is not staleness, it is the point. The network is still asked in the background, so panning keeps filling the cache. |
| **Separate cache**, spared on `activate` | The activate handler deletes every other cache. Without the exception the stored map would be thrown away on every deploy, which is the one thing offline maps cannot do. |
| **1,200 tiles**, trimmed oldest-first in batches of 150 | 30–60MB: several towns at street zoom or one city in detail. Insertion order is close enough to LRU — the tiles added longest ago are the places the driver has moved on from — and true LRU needs a timestamp per tile and somewhere to keep it. |
| **`r.ok \|\| r.type === 'opaque'`** | A no-CORS tile fetch returns an *opaque* response with status 0. Checking `r.ok` alone rejects every real tile and caches precisely nothing. |
| A 404 is **not** stored | A captive-portal redirect or a 404 cached as a tile is a permanent grey square. |
| **GETs only**, checked before the tile branch | A POST to Supabase or Stripe answered from a cache is a booking that did not happen, reported as one that did. |
| The app shell stays **network-first** | Cache-first for the shell is how "deployed but users see the old version" happens. |

### Who gets them

The worker cannot check entitlement: Premium lives in `promo_redemptions` behind
the Supabase anon key, which is in the app bundle and not in the worker. So the
page is the authority and posts the answer.

`tilesOn` starts **false**, and that matters — it is a variable in memory, the
browser stops and restarts a worker whenever it likes, and it comes back false.
That is the right default (cache nothing until told) and the reason
`setOfflineMaps()` is called on every render of the effect rather than once.

Switching it off also **deletes what is stored**. Otherwise a lapsed subscriber
keeps fifty megabytes with no way to shift it short of clearing site data. A
subscriber can clear it themselves from the account menu, because a feature
somebody paid for that they cannot see is a feature they will not believe they
got.

## Tests

```
node tests/unit/premium.test.mjs    # 11 checks — every claim has code behind it
node tests/unit/swTiles.test.mjs    # 13 checks — the shipped worker, executed
```

Both are covered by 39 mutations.

**`swTiles.test.mjs` runs the real `public/sw.js`.** It was meant to be a
browser test, and cannot be: Playwright's `context.route` does **not** intercept
requests made from inside a service worker. The page's fetch goes through the
worker, the worker's own `fetch()` bypasses routing entirely and hits the
network, which the sandbox blocks — a probe confirmed zero route hits and an
empty cache. So the worker is loaded into a `vm` context with a fake `self`, a
Map-backed Cache API and a controllable `fetch`, and every branch is driven:
cached, uncached, offline, over the cap, not entitled, cleared, POST, deploy.
Nothing in the file is rewritten for it.

Three mutations initially passed on nothing, and each taught something:

- Removing a second `cache.match()` from the offline catch block changed no
  outcome — **it was unreachable**, because the hit path returns before the
  fetch is attempted. It was deleted rather than left looking like a guarantee.
- The fake `CacheStorage.match` returned `undefined`, which made a cache-first
  rewrite of the app shell indistinguishable from network-first. It now searches
  every cache, as the real one does.
- A check for `}, [isPremium])` was satisfied by a different effect elsewhere in
  App.jsx; it now reads from the effect under test.

## Deploying it

Nothing to apply. `public/sw.js` ships with the build, and the cache name bump
(`parkeasy-v7` → `v8`) clears the old app shell while leaving the tile cache
alone.
