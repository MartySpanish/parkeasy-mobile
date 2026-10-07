// Map base tiles, and why this is not one hardcoded URL any more.
//
// WHAT BROKE. The app used CARTO's raster basemaps, with a comment saying they
// were free and had no per-view cost. That was true when it was written. CARTO
// has since moved those styles behind an API key, and rather than failing they
// now serve the tiles with "API KEY REQUIRED / carto.com/basemaps/apikey"
// stamped diagonally across every one — so the map still drew, still showed
// Belfast, and was covered in somebody else's watermark. Nothing errored and no
// test could have caught it; it took a photograph of a screen.
//
// THREE PROVIDERS, IN ORDER, AND THE KEYS DECIDE.
//
//   VITE_GOOGLE_MAPS_KEY set, and a session token in hand
//                                → Google's official Map Tiles API 2D tiles.
//                                  The imagery the owner actually wants.
//   else VITE_CARTO_API_KEY set   → CARTO's dark_all / voyager, as before. The
//                                  polished styles that match the app theme.
//   else                         → OpenStreetMap standard tiles, keyless and
//                                  free, with the dark theme produced by a CSS
//                                  filter over them (see .map-osm-tiles in
//                                  index.css).
//
// So it still works with no account at all, and each better provider switches
// on by setting one environment variable and redeploying — no code change.
//
// GOOGLE IS THE ONLY ONE THAT NEEDS TWO REQUESTS, AND THAT SHAPES EVERYTHING
// BELOW. The official API will not serve a tile to a bare API key. You first
// POST to createSession with the map configuration and it hands back a `session`
// token, good for about two weeks, which then rides on every tile URL:
//
//   POST https://tile.googleapis.com/v1/createSession?key=KEY
//        {"mapType":"roadmap","language":"en-GB","region":"GB"}
//     -> {"session":"...","expiry":"<seconds since epoch>","tileWidth":256,...}
//   GET  https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=S&key=KEY
//
// DO NOT REPLACE THIS WITH mt0.google.com/vt?lyrs=... OR ANY RELATION OF IT.
// Those hosts are Google Maps' own internal tile endpoints. They need no
// session, they are two lines of code, and using them is a breach of the Google
// Maps Platform Terms of Service that gets the API key and the billing account
// suspended — taking Places, geocoding and the rest of the app down with it. The
// session dance is the price of the imagery being licensed. tests/unit/
// mapTiles.test.mjs fails the build if those endpoints ever appear here.
//
// THE SESSION FETCH IS ASYNC, SO IT MUST NOT BE ON THE CRITICAL PATH. A map
// renders synchronously; the token arrives whenever the network feels like it,
// and may never arrive at all (no billing on the project, Map Tiles API not
// enabled, offline, blocked). Every one of those ends the same way: no session,
// so buildProvider falls through to CARTO or OSM and the driver gets a map.
// A blank map is never one of the outcomes. The token is cached in
// localStorage, so the first visit is the only one that can start on a
// fallback — after that Google is up from the very first paint.
//
// ATTRIBUTION FOLLOWS THE PROVIDER ACTUALLY IN USE. Crediting CARTO while
// serving OpenStreetMap tiles is both wrong and a licence breach, and crediting
// OpenStreetMap over Google's imagery is the same mistake in the other
// direction, so the string is derived rather than fixed.
//
// WHY THE PURE `build*` FUNCTIONS EXIST. Everything public here reads
// import.meta.env, which a Node test cannot set, so the branch that matters
// most — the one with a key — would be untestable. The builders take the keys
// as arguments and hold all the logic; the exported functions are the two-line
// env readers on top. tests/unit/mapTiles.test.mjs drives the builders.

const CARTO_DARK  = 'https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png';
const CARTO_LIGHT = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
// No {s}: OSM retired the a/b/c subdomains and asks for the single host. That
// host is spelled out in the site CSP's img-src — the wildcard that was already
// there, *.tile.openstreetmap.org, does NOT match a bare tile.openstreetmap.org,
// and without the exact host every tile is blocked and the map draws blank.
export const OSM_TILE_HOST = 'https://tile.openstreetmap.org';
const OSM = `${OSM_TILE_HOST}/{z}/{x}/{y}.png`;

// One host for both the session POST and the tiles, which is why it has to be
// in BOTH connect-src and img-src. It is a subdomain of googleapis.com, so the
// https://*.googleapis.com already in the CSP does cover it — but it is listed
// explicitly too, because "there is a wildcard, it will be fine" is exactly the
// reasoning that blanked the map over tile.openstreetmap.org.
export const GOOGLE_TILE_HOST = 'https://tile.googleapis.com';
const GOOGLE_2D_TILES = `${GOOGLE_TILE_HOST}/v1/2dtiles`;
export const GOOGLE_SESSION_ENDPOINT = `${GOOGLE_TILE_HOST}/v1/createSession`;

// "contributors" is not decoration: it is the wording the OSM licence asks for.
const OSM_ATTR = '&copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const CARTO_ATTR = `${OSM_ATTR} &copy; <a href="https://carto.com/attributions">CARTO</a>`;
// Google's imagery is not OSM data, so the OSM credit does NOT belong here —
// naming the wrong source is the licence breach, in either direction. Google's
// policies additionally want the Google logo on the map and the per-viewport
// copyright line from the /v1/viewport endpoint; this is the text half of that
// and the minimum the API may be used with.
const GOOGLE_ATTR = 'Map data &copy; <a href="https://www.google.com/intl/en-GB/help/terms_maps/">Google</a>';

// The map configuration a session is created for. A token is bound to exactly
// this configuration, so these three live in one place and the fingerprint that
// guards the cache is derived from them rather than typed out twice.
const GOOGLE_MAP_TYPE = 'roadmap';
const GOOGLE_LANGUAGE = 'en-GB';
const GOOGLE_REGION = 'GB';

/**
 * Which provider is serving tiles right now.
 *
 * `google` is an object or nothing, NOT a key, and that is the whole point: a
 * Google key on its own cannot fetch a tile, so a key with no session yet must
 * count as "Google not available" and fall through. Anything else would render
 * tile URLs with `session=undefined` on them — 400 from every tile, and a blank
 * map, which is the one outcome this file exists to prevent.
 */
export const buildProvider = (key, google = null) => {
  if (google && google.key && google.session) return 'google';
  return key ? 'carto' : 'osm';
};

const googleTileUrl = (google) =>
  `${GOOGLE_2D_TILES}/{z}/{x}/{y}?session=${encodeURIComponent(google.session)}&key=${encodeURIComponent(google.key)}`;

/** The tile URL for the given keys and theme. No keys at all → OSM. */
export const buildTileUrl = (key, light = false, google = null) => {
  switch (buildProvider(key, google)) {
    case 'google': return googleTileUrl(google);
    case 'carto':  return `${light ? CARTO_LIGHT : CARTO_DARK}?api_key=${encodeURIComponent(key)}`;
    default:       return OSM;
  }
};

export const buildAttribution = (key, google = null) => {
  switch (buildProvider(key, google)) {
    case 'google': return GOOGLE_ATTR;
    case 'carto':  return CARTO_ATTR;
    default:       return OSM_ATTR;
  }
};

/**
 * Every prop a <TileLayer> needs, as one object to spread.
 *
 * WHY A SPREAD AND NOT FOUR PROPS. `subdomains` only means anything for a {s}
 * placeholder and the OSM and Google urls have none, so the honest thing is to
 * not pass it — and passing `subdomains={undefined}` is NOT the same as not
 * passing it. react-leaflet hands the whole props object to L.TileLayer,
 * Leaflet's setOptions copies own keys including the undefined one over its
 * 'abc' default, and the first tile then dies in _getSubdomain reading
 * `this.options.subdomains.length`. That throw happens during render, so it
 * does not break the map — it unmounts the entire app and leaves a white
 * screen. Omitting the key is the only version that works.
 *
 * WHY detectRetina IS OFF FOR GOOGLE, AND ONLY FOR GOOGLE. Leaflet implements
 * it by halving tileSize and adding one to the zoom — four tile requests where
 * there was one — and only swaps in an @2x image if the url has an {r} for it.
 * CARTO's does; Google's 2dtiles url has no such placeholder, so retina
 * detection there would quadruple a metered bill for no extra sharpness. Google
 * does high-DPI at the other end instead: the session is created with
 * highDpi/scaleFactor2x on a retina screen, which returns 512px images for the
 * same tile coordinate, and the browser draws them into 256 CSS px. One
 * request, crisp tiles. See buildSessionRequest.
 */
export const buildTileLayerProps = (key, light = false, google = null) => {
  const provider = buildProvider(key, google);
  return {
    url: buildTileUrl(key, light, google),
    attribution: buildAttribution(key, google),
    detectRetina: provider !== 'google',
    ...(provider === 'carto' ? { subdomains: 'abcd' } : {}),
  };
};

/**
 * The class that says "these tiles are OSM's light-styled ones".
 *
 * It deliberately does NOT know about the theme. The first version returned
 * 'map-dark-tiles' only in dark mode, which is correct exactly once: the class
 * is computed during render, so toggling the theme left the old class on the
 * map until something else happened to re-render it, and a light-mode user got
 * an inverted map. Whether to invert is a question CSS can answer on its own
 * from [data-theme], and CSS cannot go stale.
 *
 * Empty for CARTO — dark_all is already dark, and inverting it gives a white
 * map. Empty for Google too: the filter is `invert(1) hue-rotate(180deg)`
 * tuned for OSM's own palette, and putting it over Google's roadmap gives a
 * photo-negative of it rather than a dark map. Google roadmap therefore stays
 * light in both themes until it is dark-styled properly, at the session end,
 * with the API's `styles` field.
 */
export const buildTileClass = (key, light = false, google = null) =>
  (buildProvider(key, google) === 'osm' ? 'map-osm-tiles' : '');

// ---------------------------------------------------------------- the session
//
// Everything from here to the env readers is about getting one string — the
// session token — and never letting the attempt hurt anybody. The pure pieces
// are exported because the failure modes (a 403 body, a token that expired
// while the tab was asleep, a session minted for a different configuration) are
// exactly what a Node test can drive and a browser cannot be made to repeat.

/**
 * The createSession call, as data rather than as a fetch, so a test can read
 * what would have been sent.
 *
 * mapType/language/region are the required fields. A token is bound to the
 * mapType it was created with, so a roadmap session cannot fetch a satellite
 * tile — which is why the map type is a constant here and not an argument.
 */
export const buildSessionRequest = (key, hiDpi = false) => ({
  url: `${GOOGLE_SESSION_ENDPOINT}?key=${encodeURIComponent(key)}`,
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    mapType: GOOGLE_MAP_TYPE,
    language: GOOGLE_LANGUAGE,
    region: GOOGLE_REGION,
    // highDpi alone is ignored; it is the flag that says "I meant the scale".
    ...(hiDpi ? { highDpi: true, scale: 'scaleFactor2x' } : {}),
  }),
});

/**
 * What a cached token must match to still be usable. It is the request body
 * plus the key, so it cannot drift from the thing it describes: change the
 * region, the scale or the Google project and every stored token is invalidated
 * by construction instead of being reused for a configuration it was not
 * minted for. The key is not a secret — it ships in the JS bundle.
 */
export const buildSessionFingerprint = (key, hiDpi = false) =>
  `${buildSessionRequest(key, hiDpi).body}|${key}`;

/** Five minutes' grace, so a token is never spent on its last breath. */
export const SESSION_SKEW_MS = 5 * 60 * 1000;

/**
 * A createSession response turned into the record to store, or null.
 *
 * `expiry` comes back as seconds since the epoch, and as a STRING — a JSON
 * number would have lost precision, so the API quotes it. Number() it once
 * here; multiplying a string by 1000 elsewhere is how that becomes NaN.
 */
export const buildSessionRecord = (body, fingerprint) => {
  const session = body && typeof body.session === 'string' ? body.session : '';
  const expirySec = Number(body && body.expiry);
  if (!session) return null;
  if (!Number.isFinite(expirySec) || expirySec <= 0) return null;
  return { session, expirySec, fingerprint };
};

/**
 * The usable token out of whatever is in localStorage, or ''.
 *
 * Every rejection here is a real thing that happens: a half-written record, a
 * token from before the region changed, and above all an expired one — a tab
 * left open for a fortnight, or a phone that restored a session from two weeks
 * ago. An expired token is not an error at tile time; it is 403s on every tile
 * and a blank map, so it is treated as no token at all and the fallback
 * provider draws.
 */
export const buildStoredSession = (raw, fingerprint, nowMs) => {
  let record = raw;
  if (typeof raw === 'string') {
    try { record = JSON.parse(raw); } catch { return ''; }
  }
  if (!record || typeof record !== 'object') return '';
  if (record.fingerprint !== fingerprint) return '';
  if (typeof record.session !== 'string' || !record.session) return '';
  const expiryMs = Number(record.expirySec) * 1000;
  if (!Number.isFinite(expiryMs)) return '';
  if (expiryMs - SESSION_SKEW_MS <= nowMs) return '';
  return record.session;
};

const SESSION_STORE_KEY = 'parkeasy.googleTileSession.v1';

const cartoKey = () => {
  try { return import.meta.env?.VITE_CARTO_API_KEY || ''; } catch { return ''; }
};

const googleKey = () => {
  try { return import.meta.env?.VITE_GOOGLE_MAPS_KEY || ''; } catch { return ''; }
};

/** True when the app is in light mode. Defaults to dark, the app's own default. */
const isLight = () => {
  try {
    return typeof document !== 'undefined'
      && document.documentElement.getAttribute('data-theme') === 'light';
  } catch { return false; }
};

const isHiDpi = () => {
  try { return Number(globalThis.devicePixelRatio) > 1.25; } catch { return false; }
};

const readStore = (k) => {
  try { return globalThis.localStorage ? globalThis.localStorage.getItem(k) : null; }
  catch { return null; }
};
const writeStore = (k, v) => {
  // Private browsing and a full quota both throw on setItem. Losing the cache
  // costs one extra createSession call; throwing here would cost the map.
  try { if (globalThis.localStorage) globalThis.localStorage.setItem(k, v); } catch { /* fine */ }
};

// The one piece of mutable state in the module: '' until a token is in hand.
let session = '';
let asked = false;

// ---------------------------------------------------------- telling React
//
// THE BUG THIS FIXES. The session arrives asynchronously and is stored in the
// module variable above. tileLayerProps() reads it at render time — but React
// has no idea the variable changed, so nothing re-renders and the map keeps the
// OSM url it mounted with. react-leaflet 4 DOES call layer.setUrl() when the
// url prop changes (see its TileLayer.js), so the only missing piece was a
// re-render; without one the switch to Google waited on some unrelated state
// change happening to re-render that component, which on a static map screen
// may be never.
//
// The practical effect was that a first-time visitor — nobody with a cached
// token — got an OpenStreetMap map and kept it for the whole visit, and only a
// second page load came up on Google. That is the wrong first impression of the
// app and it is what this subscription exists to stop.
const listeners = new Set();

/** Subscribe to "the tile provider may have changed". Returns an unsubscribe. */
export const onTilesChanged = (fn) => {
  if (typeof fn !== 'function') return () => {};
  listeners.add(fn);
  return () => { listeners.delete(fn); };
};

// One listener throwing must not stop the others being told, or a single bad
// subscriber leaves every other map on the fallback provider.
const notifyTilesChanged = () => {
  for (const fn of [...listeners]) {
    try { fn(); } catch (e) { console.error('tile listener', e); }
  }
};

/** The Google pair the builders want, or null while there is no session. */
export const googleTiles = () => {
  const key = googleKey();
  return key && session ? { key, session } : null;
};

/**
 * Get a session token, once per page load, and never throw.
 *
 * Returns '' for every failure — no key, no billing on the project, Map Tiles
 * API not enabled (403), CSP or CORS, offline, garbage body. The caller does
 * not branch on why: no token means buildProvider picks CARTO or OSM, which is
 * a working map.
 */
export const ensureGoogleSession = async () => {
  const key = googleKey();
  if (!key || asked) return session;
  asked = true;

  const hiDpi = isHiDpi();
  const fingerprint = buildSessionFingerprint(key, hiDpi);

  const cached = buildStoredSession(readStore(SESSION_STORE_KEY), fingerprint, Date.now());
  // The cached path is synchronous at import time, so no listener exists yet to
  // tell — the first render already reads the token. Notifying anyway is both
  // harmless and correct if this is ever called again.
  if (cached) { session = cached; notifyTilesChanged(); return session; }

  try {
    const req = buildSessionRequest(key, hiDpi);
    const res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body });
    if (!res || !res.ok) {
      // WHY THIS LOGS. Every failure here looks identical from the outside: the
      // map quietly draws OpenStreetMap. Working out which failure it was has
      // cost real time — the most common by far is a 403 because the Map Tiles
      // API is not enabled, or has no billing account, on the project that owns
      // the key; a referrer-restricted key also 403s on a vercel.app preview
      // domain while working on parkeasy.uk. The status and Google's own
      // message say which in one line, so nobody has to guess again.
      const detail = await (res ? res.text().catch(() => '') : Promise.resolve(''));
      console.warn(
        `[ParkEasy] Google Map Tiles unavailable — HTTP ${res ? res.status : 'no response'}. `
        + 'Falling back to CARTO/OpenStreetMap. Usually: Map Tiles API not enabled, '
        + 'no billing on the key\'s project, or an HTTP-referrer restriction that '
        + `excludes this domain. Google said: ${String(detail).slice(0, 300)}`);
      return '';
    }
    const record = buildSessionRecord(await res.json(), fingerprint);
    if (!record) {
      console.warn('[ParkEasy] Google Map Tiles returned no usable session token.');
      return '';
    }
    session = record.session;
    writeStore(SESSION_STORE_KEY, JSON.stringify(record));
    // The whole point of the subscription: the map mounted on a fallback and
    // now has to be told to come back and read the Google url.
    notifyTilesChanged();
    return session;
  } catch (e) {
    console.warn('[ParkEasy] Google Map Tiles session request failed:', e?.message || e);
    return '';
  }
};

/**
 * May this provider's tiles be STORED on the device for offline use?
 *
 * This is a licence question wearing the clothes of a boolean, and it decides
 * whether a paid feature is real.
 *
 * OSM and CARTO tiles may be cached — public/sw.js does exactly that, and the
 * Premium "offline maps" benefit is built on it. Google's Map Tiles terms
 * restrict pre-fetching and storing tiles, so its tiles are NOT cached, which
 * means that with Google serving the basemap there is nothing in the cache and
 * offline maps cannot work.
 *
 * WHY THIS EXISTS RATHER THAN A COMMENT. src/premium.js opens by listing the
 * two Premium claims that were once untrue, and the first of them is "Offline
 * maps — works without signal" when there were no offline maps: somebody paid
 * £29 a year partly for that. Switching the basemap to Google silently
 * recreates that exact lie, and the existing proof check would not catch it,
 * because sw.js still contains TILE_CACHE — the cache is real, it is just
 * permanently empty. So the app asks this question directly and stops selling
 * the feature when the answer is no.
 */
export const buildTilesCacheable = (provider) => provider !== 'google';

export const tileProvider = () => buildProvider(cartoKey(), googleTiles());
export const tilesCacheable = () => buildTilesCacheable(tileProvider());
export const usingGoogle = () => tileProvider() === 'google';
export const usingCarto = () => tileProvider() === 'carto';
export const tileUrl = () => buildTileUrl(cartoKey(), isLight(), googleTiles());
export const tileAttribution = () => buildAttribution(cartoKey(), googleTiles());
export const tileLayerProps = () => buildTileLayerProps(cartoKey(), isLight(), googleTiles());
export const tileThemeClass = () => buildTileClass(cartoKey(), isLight(), googleTiles());

// Start the session request at import time, which is as early as this app can
// ask: main.jsx imports App.jsx, App.jsx imports this, and all of that happens
// before a MapContainer mounts. With a cached token there is nothing to wait
// for and the first paint is Google. Without one it is a race the fallback
// provider wins, and the map switches over on the next render — a working map
// throughout, which is the requirement. It cannot reject (ensureGoogleSession
// swallows everything) but a stray .catch costs nothing and an unhandled
// rejection in a service-worker-registering app is a console full of noise.
if (googleKey()) {
  try { Promise.resolve(ensureGoogleSession()).catch(() => {}); } catch { /* fine */ }
}
