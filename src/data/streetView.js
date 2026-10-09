// The picture on a spot card, and the two ways it was wrong.
//
// DEFECT 1 — WE PAID GOOGLE FOR GREY RECTANGLES. The card went straight to the
// Street View Static *image* endpoint:
//
//   https://maps.googleapis.com/maps/api/streetview?location=LAT,LNG&key=…
//
// When there is no panorama at those coordinates that endpoint does NOT 404.
// It answers **HTTP 200 with a grey "Sorry, we have no imagery here" image**.
// So `<img onError>` never fires, nothing is logged, and the card shows a grey
// rectangle — while the request is billed, because image requests are a
// metered SKU. Half of ParkEasy's inventory is a GAA club car park up a lane, a
// church yard or a layby, which is exactly where Street View has no coverage.
//
// Google publishes a free endpoint for precisely this question:
//
//   https://maps.googleapis.com/maps/api/streetview/metadata?location=…&key=…
//     -> {"status":"OK"}            a panorama exists
//     -> {"status":"ZERO_RESULTS"}  none near this location
//
// Metadata requests are documented as free and consume no quota, so asking
// first costs nothing and stops us buying images nobody can use.
//
// DEFECT 2 — THE FALLBACK WAS DEAD CODE. spotImageUrl() ended with a comment
// saying "Falls back to a free OpenStreetMap static map tile — no key needed",
// and its own body did. But the one caller read:
//
//   spot.photo || (GOOGLE_MAPS_KEY ? spotImageUrl(spot.lat, spot.lng) : null)
//
// so with no key the caller passed null and the keyless branch could never be
// reached. A deployment without VITE_GOOGLE_MAPS_KEY showed no picture at all.
//
// THE SHAPE OF THE FIX IS THE ONE src/mapTiles.js ALREADY USES for the
// basemap: never render nothing, start on the free provider, and upgrade only
// once the better one is confirmed available. So a card paints the
// OpenStreetMap static map immediately — synchronously, no key, always works —
// and swaps in Street View only after metadata has said OK. A blank card and a
// grey card are both off the table.
//
// EVERY ANSWER IS CACHED, INCLUDING "NO". There are ~740 spots and the list
// re-renders on every keystroke, filter and sort. Without a cache this would
// re-ask Google about the same layby dozens of times per session; without
// caching the NEGATIVE answers it would re-ask forever about the spots that
// will never have imagery, which is most of them.

/** The size both providers are asked for, so the swap is not a visible resize. */
export const IMAGE_SIZE = '600x300';

const MAPS_HOST = 'https://maps.googleapis.com/maps/api/streetview';

/** The keyless map that is always available. Already in the site's img-src CSP. */
export const osmStaticUrl = (lat, lng, size = IMAGE_SIZE) =>
  `https://staticmap.openstreetmap.de/staticmap.php?center=${lat},${lng}`
  + `&zoom=17&size=${size}&maptype=mapnik&markers=${lat},${lng},red-pushpin`;

/** The free question: is there a panorama here? */
export const metadataUrl = (lat, lng, key) =>
  `${MAPS_HOST}/metadata?location=${lat},${lng}&key=${encodeURIComponent(key)}`;

/** The billed answer. Only ever built once metadata has said OK. */
export const streetViewUrl = (lat, lng, key, size = IMAGE_SIZE) =>
  `${MAPS_HOST}?size=${size}&location=${lat},${lng}&fov=90&pitch=0&key=${encodeURIComponent(key)}`;

/**
 * Is this a usable pair of coordinates?
 *
 * `0,0` is in the Gulf of Guinea and is what a missing lat/lng arrives as once
 * something has helpfully coerced it — Number(null) is 0. A card for a spot
 * with no position must show no picture rather than the Atlantic.
 */
export const hasCoords = (lat, lng) =>
  Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))
  && !(Number(lat) === 0 && Number(lng) === 0)
  && Math.abs(Number(lat)) <= 90 && Math.abs(Number(lng)) <= 180;

/**
 * Only 'OK' counts. ZERO_RESULTS, REQUEST_DENIED (bad key, API not enabled),
 * OVER_QUERY_LIMIT and INVALID_REQUEST all mean "do not buy an image".
 */
export const hasPanorama = (body) => !!body && body.status === 'OK';

/**
 * The cache key. Five decimal places is about a metre — fine enough that two
 * genuinely different spots never share an answer, coarse enough that the same
 * spot re-rendered is one entry.
 */
export const coordKey = (lat, lng) => `${Number(lat).toFixed(5)},${Number(lng).toFixed(5)}`;

// key -> true (panorama) | false (none). In-flight promises are kept separately
// so N cards mounting at once make ONE request rather than N.
const answers = new Map();
const inFlight = new Map();

/** Test seam: forget everything learned. */
export const resetPanoramaCache = () => { answers.clear(); inFlight.clear(); };

/** What is already known, without asking: true, false, or undefined. */
export const knownPanorama = (lat, lng) => answers.get(coordKey(lat, lng));

/**
 * Ask Google whether a panorama exists, at most once per location per session.
 *
 * NEVER THROWS and never rejects. A network failure, a blocked request, a bad
 * key or a body that is not JSON all resolve to false, which keeps the card on
 * the OpenStreetMap map — the same "a failure is a working fallback, not an
 * error" rule mapTiles.js states for the basemap.
 */
export async function checkPanorama(lat, lng, key, fetchImpl) {
  if (!key || !hasCoords(lat, lng)) return false;
  const k = coordKey(lat, lng);
  if (answers.has(k)) return answers.get(k);
  if (inFlight.has(k)) return inFlight.get(k);

  const doFetch = fetchImpl || (typeof fetch === 'function' ? fetch : null);
  if (!doFetch) return false;

  // ONE failure net, deliberately. The first version had a try/catch here AND
  // a .catch() on the chain, and the mutation pass showed why that is worse
  // than it looks: either one alone handled every failure, so removing either
  // changed nothing and no test could tell the difference. Two guards that
  // cover each other are two guards nobody can prove are needed. This records
  // the answer and clears the in-flight entry on exactly one path.
  const p = (async () => {
    let ok = false;
    try {
      const res = await doFetch(metadataUrl(lat, lng, key));
      if (res && res.ok) ok = hasPanorama(await res.json());
    } catch {
      ok = false;           // offline, blocked, CORS, not JSON — all "no imagery"
    }
    // answers FIRST, and it is the one that matters: checkPanorama reads it
    // before inFlight, so this line is what makes the result stick.
    answers.set(k, ok);
    // Housekeeping, with no observable behaviour — ~740 resolved promises would
    // simply sit in the Map. Said out loud because the mutation pass proved no
    // test can cover it: removing it changes nothing a caller can see.
    inFlight.delete(k);
    return ok;
  })();

  inFlight.set(k, p);
  return p;
}

/**
 * The URL to show right now, with no waiting and no network.
 *
 * Returns null only when there are no usable coordinates — in which case the
 * card draws its icon, which is the honest thing to show for a spot whose
 * position we do not have.
 */
export function spotImageNow(lat, lng, key, size = IMAGE_SIZE) {
  if (!hasCoords(lat, lng)) return null;
  if (key && knownPanorama(lat, lng) === true) return streetViewUrl(lat, lng, key, size);
  return osmStaticUrl(lat, lng, size);
}
