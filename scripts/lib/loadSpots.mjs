// Every spot the app renders, loaded once, for the build steps that need them.
//
// WHY THIS IS SHARED. generate-globe-data.mjs already had this loader, and
// inject-destination-pages.mjs needs exactly the same list. Copying it would
// have created a second source of truth for "what spots exist" — the same
// duplication that made the publish gate diverge between App.jsx and
// api/publish-listing.js, where one copy was relaxed and the other was not and
// the bug lived for a whole release.
//
// READS THE LITERALS OUT OF App.jsx BY BRACE MATCHING rather than importing,
// because App.jsx pulls in React and Leaflet and cannot be loaded in Node —
// the same approach as scripts/generate-gem-seed.mjs.
import { readFileSync } from 'fs';
import { EXTRA_SPOTS } from '../../src/extraSpots.js';
import { EV_SPOTS }    from '../../src/evSpots.js';
import { PILOT_SPOTS } from '../../src/pilotSpots.js';
import { APCOA_SPOTS } from '../../src/apcoaSpots.js';

const APP = new URL('../../src/App.jsx', import.meta.url);

/**
 * Brace-match one top-level literal out of App.jsx.
 * Exported because generate-gem-seed.mjs-style callers may want a single array.
 */
export function literalFrom(src, name, open, close) {
  const at = src.indexOf(`const ${name}`);
  if (at < 0) throw new Error(`${name} not found in App.jsx`);
  let i = src.indexOf(open, src.indexOf('=', at)), depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === open) depth++;
    else if (src[j] === close) { depth--; if (depth === 0) return src.slice(i, j + 1); }
  }
  throw new Error(`unbalanced ${open} in ${name}`);
}

/**
 * Every spot, with `_city` set to the key it was filed under.
 *
 * Order is CITY_SPOTS, then the extra modules in the order the app imports
 * them, because the globe's output is diffed between builds and a reordering
 * would read as a data change when nothing changed.
 */
export function loadAllSpots() {
  const src = readFileSync(APP, 'utf8');
  const literal = (name, open, close) => literalFrom(src, name, open, close);

  const CITY_SPOTS = {};
  for (const [, city, ident] of literal('CITY_SPOTS', '{', '}').matchAll(/^\s*([a-z]+):\s*([A-Z_]+),/gm)) {
    CITY_SPOTS[city] = eval('(' + literal(ident, '[', ']') + ')');
  }

  const all = [];
  for (const map of [CITY_SPOTS, EXTRA_SPOTS, EV_SPOTS, PILOT_SPOTS, APCOA_SPOTS]) {
    for (const [city, arr] of Object.entries(map)) {
      if (!Array.isArray(arr)) continue;
      for (const s of arr) all.push({ ...s, _city: city });
    }
  }
  return all;
}
