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
// TWO PROVIDERS, AND THE KEY DECIDES.
//
//   With VITE_CARTO_API_KEY set  → CARTO's dark_all / voyager, as before. The
//                                  polished styles that match the app theme.
//   Without it                   → OpenStreetMap standard tiles, keyless and
//                                  free, with the dark theme produced by a CSS
//                                  filter over them (see .map-dark-tiles in
//                                  index.css).
//
// So it works today with no account at all, and if CARTO's free tier is signed
// up for, the good styles come back by setting one environment variable and
// redeploying — no code change.
//
// ATTRIBUTION FOLLOWS THE PROVIDER ACTUALLY IN USE. Crediting CARTO while
// serving OpenStreetMap tiles is both wrong and a licence breach, so the string
// is derived rather than fixed.
//
// WHY THE PURE `build*` FUNCTIONS EXIST. Everything public here reads
// import.meta.env, which a Node test cannot set, so the branch that matters
// most — the one with a key — would be untestable. The builders take the key as
// an argument and hold all the logic; the exported functions are the two-line
// env readers on top. tests/unit/mapTiles.test.mjs drives the builders.

const CARTO_DARK  = 'https://{s}.basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png';
const CARTO_LIGHT = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
// No {s}: OSM retired the a/b/c subdomains and asks for the single host. That
// host is spelled out in the site CSP's img-src — the wildcard that was already
// there, *.tile.openstreetmap.org, does NOT match a bare tile.openstreetmap.org,
// and without the exact host every tile is blocked and the map draws blank.
export const OSM_TILE_HOST = 'https://tile.openstreetmap.org';
const OSM = `${OSM_TILE_HOST}/{z}/{x}/{y}.png`;

// "contributors" is not decoration: it is the wording the OSM licence asks for.
const OSM_ATTR = '&copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const CARTO_ATTR = `${OSM_ATTR} &copy; <a href="https://carto.com/attributions">CARTO</a>`;

/** The tile URL for a given key and theme. `key` empty/missing → OSM. */
export const buildTileUrl = (key, light = false) => {
  if (!key) return OSM;
  const base = light ? CARTO_LIGHT : CARTO_DARK;
  return `${base}?api_key=${encodeURIComponent(key)}`;
};

export const buildAttribution = (key) => (key ? CARTO_ATTR : OSM_ATTR);

/**
 * Every prop a <TileLayer> needs, as one object to spread.
 *
 * WHY A SPREAD AND NOT FOUR PROPS. `subdomains` only means anything for a {s}
 * placeholder and the OSM url has none, so the honest thing is to not pass it —
 * and passing `subdomains={undefined}` is NOT the same as not passing it.
 * react-leaflet hands the whole props object to L.TileLayer, Leaflet's
 * setOptions copies own keys including the undefined one over its 'abc'
 * default, and the first tile then dies in _getSubdomain reading
 * `this.options.subdomains.length`. That throw happens during render, so it
 * does not break the map — it unmounts the entire app and leaves a white
 * screen. Omitting the key is the only version that works.
 */
export const buildTileLayerProps = (key, light = false) => ({
  url: buildTileUrl(key, light),
  attribution: buildAttribution(key),
  detectRetina: true,
  ...(key ? { subdomains: 'abcd' } : {}),
});

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
 * Empty with a CARTO key — dark_all is already dark, and inverting it gives a
 * white map.
 */
export const buildTileClass = (key) => (key ? '' : 'map-osm-tiles');

const cartoKey = () => {
  try { return import.meta.env?.VITE_CARTO_API_KEY || ''; } catch { return ''; }
};

/** True when the app is in light mode. Defaults to dark, the app's own default. */
const isLight = () => {
  try {
    return typeof document !== 'undefined'
      && document.documentElement.getAttribute('data-theme') === 'light';
  } catch { return false; }
};

export const usingCarto = () => Boolean(cartoKey());
export const tileUrl = () => buildTileUrl(cartoKey(), isLight());
export const tileAttribution = () => buildAttribution(cartoKey());
export const tileLayerProps = () => buildTileLayerProps(cartoKey(), isLight());
export const tileThemeClass = () => buildTileClass(cartoKey());
