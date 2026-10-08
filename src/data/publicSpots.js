// Which spots may be named on a page built to be indexed by Google.
//
// WHY THIS NEEDS ITS OWN FILE. Hidden gems are the paid half of the product —
// 20260820_hidden_gems.sql exists because they used to ship to every browser
// in the app bundle, where "the lock is drawn in the UI; the exact coordinates
// and notes are one devtools tab away for anybody who has never paid".
// generate-globe-data.mjs carries the same warning for the same reason.
//
// A public /area page is the widest possible side door into that hole: it is
// static HTML, it is served to anyone, and its whole job is to be read by
// crawlers. Naming one gem on it would give away, permanently and to everyone,
// the thing nine people currently pay for.
//
// So this mirrors App.jsx's isGated(), inverted. It is deliberately a separate
// mirror rather than an import, because App.jsx cannot be loaded in Node — and
// destinationPages.test.mjs asserts the two rules still agree, clause by
// clause, so a change to one that is not made to the other fails the build
// rather than quietly opening the paywall.

/** Badges a driver either pays for or is restricted at — never the paid product. */
export const OPEN_BADGES = ['official', 'timed', 'paid'];

/**
 * Could this spot be named on an indexed page?
 *
 * The inverse of App.jsx's isGated(), with two deliberate differences, both
 * stricter:
 *
 *   1. `spot.mine` (a community submission by the signed-in user) has no
 *      meaning at build time and is not treated as an unlock.
 *   2. Taster gems are NOT unlocked here even though isGated() would unlock
 *      them. FREE_GEMS_TOTAL is 0 today so the set is empty either way, but if
 *      somebody re-opens tasters in the app that is a decision about the app's
 *      upsell, not a decision to publish those gems' coordinates to Google
 *      forever. Publishing is the one direction that cannot be undone.
 */
export function isPublishable(spot) {
  if (!spot || typeof spot !== 'object') return false;
  if (spot.badge === 'hidden_gem') return false;     // the paid product, always
  if (!Number.isFinite(spot.lat) || !Number.isFinite(spot.lng)) return false;
  if (!spot.name) return false;
  if (spot.price) return true;                       // paid to park → free to view
  if (OPEN_BADGES.includes(spot.badge)) return true; // car parks, P&R, on-street
  return spot.premium !== true;                      // premium-flagged EV picks stay locked
}

/** Metres between two coordinates. Equirectangular, which is ample at city scale. */
export const metresBetween = (aLat, aLng, bLat, bLng) =>
  Math.hypot((bLat - aLat) * 111320, (bLng - aLng) * Math.cos((aLat * Math.PI) / 180) * 111320);

/** Minutes on foot at a brisk 80 m/min, never less than 1. */
export const walkMinutes = (metres) => Math.max(1, Math.round(metres / 80));

/**
 * The publishable spots nearest a destination, closest first.
 *
 * De-duplicated by name: the same lay-by is sometimes filed under two towns,
 * and a page listing it twice reads as padding.
 */
export function nearestPublishable(spots, { lat, lng }, { radiusM = 1200, limit = 6 } = {}) {
  const seen = new Set();
  return (spots || [])
    .filter(isPublishable)
    .map(s => ({ spot: s, metres: metresBetween(lat, lng, s.lat, s.lng) }))
    .filter(x => x.metres <= radiusM)
    .sort((a, b) => a.metres - b.metres || String(a.spot.name).localeCompare(String(b.spot.name)))
    .filter(({ spot }) => {
      const k = String(spot.name).trim().toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .slice(0, limit)
    .map(x => ({ ...x, walkMin: walkMinutes(x.metres) }));
}

/** Is anything here free to park at? Used for the page's one honest claim. */
export const hasFree = (rows) => rows.some(r => r.spot.badge === 'free' && !r.spot.price);
