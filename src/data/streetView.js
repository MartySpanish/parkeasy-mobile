// The picture on a spot card: what it may show, and what it must never request.
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
// first costs nothing and stops us buying images nobody can use. That half of
// the fix stands.
//
// DEFECT 2 — THE REPLACEMENT PROVIDER DOES NOT EXIST. The fix for defect 1
// painted a free map first and upgraded to Street View only once metadata said
// OK, so that no card was ever blank or grey. The free map was
// staticmap.openstreetmap.de — and that service is gone. The OpenStreetMap
// wiki's StaticMapLite page marks the hosted instance discontinued, describing
// it in the past tense and pointing at self-hosting instead; even while it ran,
// the OSM help answer that recommended it said plainly that it is not a
// production service for commercial applications.
//
// So every card with coordinates — which is nearly all ~790 of them, since only
// eight carry a real photo — fired a request at a dead host, the `<img>` failed,
// onError set imgErr, and the card fell back to its icon. The user-visible
// result of "always show a free map" was no map, one failed request per card,
// and a hard dependency on a volunteer service that had already been retired.
//
// WHAT IT DOES NOW. The card shows, in order: its own photo if it has one;
// Street View once metadata has CONFIRMED a panorama; otherwise nothing, and
// the card draws the gradient-and-icon tile it already had. That is what a
// visitor sees today in any case — minus the doomed request.
//
// WHY NOT A DIFFERENT FREE MAP PROVIDER. Every keyless one has the same
// volunteer-capacity answer one host further along, and every reliable one
// (Geoapify, MapTiler, Mapbox) needs its own account and key. Google's own
// Maps Static API is the natural choice — same key, same project, same billing
// that Map Tiles and Street View need — but it is billed per request, and a
// map on every one of ~790 cards is a per-scroll bill nobody has agreed to.
// That is a commercial decision, not a code one, so this file does not make it.
//
// DEFECT 3 — A DISABLED API COST A REQUEST PER SPOT, FOREVER. Every non-OK
// metadata status was treated the same: "no imagery here", cached per location.
// But REQUEST_DENIED is not a fact about a location — it is a fact about the
// KEY (API not enabled, billing off, referrer restriction), and it will be the
// answer for every one of the ~790 spots. The list re-renders on every
// keystroke, filter and sort, so a key that Google is refusing produced a
// metadata request per spot per session, each one guaranteed to be refused.
// A key-level refusal now stops the asking for the rest of the page load.
// See KEY_REFUSALS.

/**
 * The size asked for, matched to where it is drawn.
 *
 * The card thumbnail is 60x60 CSS pixels, so 120x120 is the retina-sharp size
 * and anything beyond it is mobile data spent on pixels nobody sees. The
 * previous 600x300 was twenty-five times the area of the box it is drawn in.
 * Street View Static bills per request and not per pixel, so this saves
 * bandwidth rather than money — on a phone on a list of hundreds of cards,
 * that is the one that matters. Callers that draw it bigger pass their own.
 */
export const IMAGE_SIZE = '120x120';

const MAPS_HOST = 'https://maps.googleapis.com/maps/api/streetview';

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
 * The statuses that are about the KEY and not about the location.
 *
 * This is the distinction defect 3 was missing. ZERO_RESULTS means "ask about
 * the next spot, it may be different". These two mean "every answer for this
 * key will be the same, stop asking": REQUEST_DENIED is the API not being
 * enabled, billing being off, or a referrer restriction that excludes this
 * domain; OVER_QUERY_LIMIT is the cap, and the cap does not lift mid-session.
 */
export const KEY_REFUSALS = new Set(['REQUEST_DENIED', 'OVER_QUERY_LIMIT']);

/** HTTP statuses that mean the same thing before a body is ever parsed. */
export const KEY_REFUSAL_HTTP = new Set([403, 429]);

export const isKeyRefusal = (body) => !!body && KEY_REFUSALS.has(body.status);

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
// Set once Google has refused the key itself. Not per location, because it is
// not a fact about a location.
let refused = false;

/** Test seam: forget everything learned, including the refusal. */
export const resetPanoramaCache = () => { answers.clear(); inFlight.clear(); refused = false; };

/** Has Google refused this key outright? Then nothing more is asked of it. */
export const keyRefused = () => refused;

/** What is already known, without asking: true, false, or undefined. */
export const knownPanorama = (lat, lng) => answers.get(coordKey(lat, lng));

/**
 * Ask Google whether a panorama exists, at most once per location per session,
 * and not at all once the key has been refused.
 *
 * NEVER THROWS and never rejects. A network failure, a blocked request, a bad
 * key or a body that is not JSON all resolve to false, which leaves the card on
 * its icon.
 */
export async function checkPanorama(lat, lng, key, fetchImpl) {
  if (!key || !hasCoords(lat, lng)) return false;
  const k = coordKey(lat, lng);
  // A real answer already in hand outranks everything, including a later
  // refusal: a panorama that was confirmed does not stop existing because the
  // quota ran out afterwards.
  if (answers.has(k)) return answers.get(k);
  // DEFECT 3. Without this, a refused key is re-asked once per spot.
  if (refused) return false;
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
      if (res && KEY_REFUSAL_HTTP.has(res.status)) refused = true;
      if (res && res.ok) {
        const body = await res.json();
        if (isKeyRefusal(body)) refused = true;
        ok = hasPanorama(body);
      }
    } catch {
      ok = false;           // offline, blocked, CORS, not JSON — all "no imagery"
    }
    // answers FIRST, and it is the one that matters: checkPanorama reads it
    // before inFlight, so this line is what makes the result stick.
    answers.set(k, ok);
    // Housekeeping, with no observable behaviour — ~790 resolved promises would
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
 * Returns null unless there is a CONFIRMED panorama, which is the whole change:
 * there is no free map to fall back to any more, so the honest answer for a
 * spot we have no picture of is no picture. The card draws its own
 * gradient-and-icon tile, which is what it already did whenever the dead static
 * map failed to load.
 */
export function spotImageNow(lat, lng, key, size = IMAGE_SIZE) {
  if (!key) return null;
  if (!hasCoords(lat, lng)) return null;
  if (knownPanorama(lat, lng) !== true) return null;
  return streetViewUrl(lat, lng, key, size);
}
