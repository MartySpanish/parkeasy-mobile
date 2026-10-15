// The map on an event or venue page, and why it is no longer a map of streets.
//
// WHAT WAS THERE. Both page types rendered a 620x320 `<img>` from
// staticmap.openstreetmap.de, with a CSS ring laid over it sized from the Web
// Mercator scale, and the caption "Map (c) OpenStreetMap contributors".
//
// WHY IT HAD TO GO — THE PROVIDER NO LONGER EXISTS. staticmap.openstreetmap.de
// is the hosted StaticMapLite instance, and the OpenStreetMap wiki's own
// StaticMapLite page marks that hosted service discontinued: it describes it in
// the past tense and points readers at self-hosting the code instead. Even
// while it was up it was never meant to carry this — the answer that first
// recommended it on OSM's help site said plainly that it is not a production
// service for use in commercial applications, and OSM's community guidance
// says the volunteer-run servers may block heavy or unapproved use without
// warning.
//
// So every /events/{slug} and every /venue/{slug} page — the public, indexed
// ones, the ones search traffic lands on — was serving a broken image and,
// underneath it, a credit line for a map that was not there. The credit was the
// worse half: attributing OpenStreetMap for imagery nobody received is the same
// class of error src/mapTiles.js exists to prevent, in the other direction.
//
// WHY NOT JUST ANOTHER STREET MAP. Three options were on the table and two are
// worse than nothing:
//
//   Another free community tile service  — the same volunteer-capacity problem
//                                          and the same commercial-use answer,
//                                          one host further along.
//   Google Maps Static API               — correct, licensed, and BILLED per
//                                          request. It is the right answer the
//                                          day the Maps Static API and billing
//                                          are switched on for the key; until
//                                          then every one of these pages would
//                                          serve a 403 image, which is exactly
//                                          the state being fixed. See the note
//                                          at the end of this file: it is a
//                                          one-function change when that is on.
//   Draw what we already know            — this file.
//
// WHAT THIS DRAWS, AND WHY IT IS NOT DECORATION. The question these pages
// exist to answer is "I am going to this venue, where do I park". The panel
// directly beneath this graphic already lists the bookable spaces with their
// distances, and a distance alone does not tell you which way to approach from
// — which is the one thing a driver deciding between them needs. So the
// diagram places each of those spaces at its true bearing and distance from the
// venue, numbered to match the list below it, with a labelled distance ring for
// scale.
//
// It is explicitly a schematic and says so in its caption. There are no streets
// in it, because we do not have street geometry we are licensed to redraw, and
// a diagram that implied a route would be claiming more than we know. Bearing
// and distance are things we can state from two coordinates and nothing else.
//
// IT COSTS NOTHING AND CANNOT BREAK. No request, no key, no quota, no external
// origin, no licence. It renders from the same rows the panel beneath it is
// built from, so the two can never disagree, and it draws identically with
// images blocked.
//
// THE PRECISION RULE, WHICH IS THE SAME ONE distanceLabel() FOLLOWS. A compass
// sector is 45 degrees wide, so for a space very close to the venue a pin that
// is a few tens of metres out can flip it into the neighbouring sector and the
// page would confidently print the wrong direction. Distances here come from
// unsurveyed pins. So a direction is only ever stated above
// DIRECTION_MIN_M — below that the space is simply "beside the venue", which
// is both true and all anybody needs at that range.
import { esc } from './_eventsView.js';

/** Metres per degree of latitude. Longitude is this scaled by cos(latitude). */
const M_PER_DEG = 111320;

/**
 * Number(), except that an absent value stays absent.
 *
 * THE TRAP THIS EXISTS FOR, which is now the fourth sighting in this codebase
 * after distanceLabel(), median() and hasCoords(): Number(null) is 0, and
 * Number('') is 0. Both are finite, so a `Number.isFinite` guard waves them
 * through — and a listing with no position was plotted as if it were at
 * latitude 0, longitude 0, in the Gulf of Guinea, which after the ring clamp
 * drew it as a space sitting on the venue's own distance ring. The first
 * version of offsetM() had exactly that bug and the test caught it, which is
 * the only reason this helper is here rather than a bare Number() call.
 */
const num = (v) => (v == null || v === '' ? NaN : Number(v));

/**
 * Metres east and north of the venue.
 *
 * Equirectangular rather than a proper projection, deliberately — but with the
 * error measured rather than asserted. Against the haversine distance the panel
 * prints (api/events.js), swept over every bearing at up to the 2km radius
 * these pages use, the worst case is 2.4m, which is 0.12%. On the 150px ring
 * that is 0.18 of a pixel: below what the drawing can express, and two orders
 * of magnitude below the pin error the DIRECTION_MIN_M rule exists for.
 *
 * The 111320 constant is the mean metres per degree of latitude; the true
 * meridian degree at 54.6N is nearer 111400, and that 0.07% is most of the
 * error above. Over a wider radius this would need the real thing.
 * tests/unit/venueMap.test.mjs pins the bound at 0.2%, so dropping the cosine
 * on the longitude term — which overstates east-west by about 72% at this
 * latitude — cannot pass.
 */
export function offsetM(vLat, vLng, lat, lng) {
  const [a, b, c, d] = [vLat, vLng, lat, lng].map(num);
  if (![a, b, c, d].every(Number.isFinite)) return null;
  return {
    e: (d - b) * M_PER_DEG * Math.cos(a * Math.PI / 180),
    n: (c - a) * M_PER_DEG,
  };
}

/** Below this, a 45-degree sector is not stable against pin error. */
export const DIRECTION_MIN_M = 150;

export const COMPASS = [
  'north', 'north-east', 'east', 'south-east',
  'south', 'south-west', 'west', 'north-west',
];

/**
 * The compass word for an offset, or null when the distance is too short to
 * state one honestly.
 *
 * `d` is passed in rather than derived so this agrees with the distance the
 * page prints, which comes from the haversine helper in api/events.js. Guarded
 * routed through num() rather than Number(): Number(null) is 0, which is finite and is below
 * DIRECTION_MIN_M, so a missing distance would silently read as "too close to
 * say" rather than "we do not know" — the same trap distanceLabel() documents.
 */
export function bearingWord(e, n, d) {
  const dist = num(d);
  if (!Number.isFinite(dist) || dist < DIRECTION_MIN_M) return null;
  const east = num(e), north = num(n);
  if (!Number.isFinite(east) || !Number.isFinite(north)) return null;
  if (east === 0 && north === 0) return null;
  const deg = (Math.atan2(east, north) * 180 / Math.PI + 360) % 360;
  return COMPASS[Math.round(deg / 45) % 8];
}

/**
 * The ring is labelled in round numbers, so it is one of these.
 *
 * The ladder is finer than the obvious 250/500/1000/2000 because of what a
 * coarse one does to the drawing: a set whose furthest space is 1120m fell
 * straight to the 2km ring, which put that dot at 84 of the 150 pixels and
 * squashed everything nearer into the middle. The rungs below keep the labels
 * round while wasting much less of the frame.
 */
export const RINGS = [250, 500, 750, 1000, 1500, 2000];

/** The smallest labelled ring everything fits inside. */
export function ringFor(maxD) {
  const m = num(maxD);
  if (!Number.isFinite(m) || m <= 0) return RINGS[1];
  return RINGS.find(r => m <= r) || RINGS[RINGS.length - 1];
}

/** "400m" / "1.2km", matching the wording distanceLabel() uses. */
export const ringLabel = (m) =>
  (m >= 1000 ? `${(Math.round(m / 100) / 10).toFixed(1)}km` : `${m}m`);

// Geometry of the drawing. One place, because the ring label, the dot
// positions and the clamp all have to agree or the scale is a lie.
const VIEW = 400;          // viewBox is square: this is a radial diagram
const CX = VIEW / 2;
const CY = VIEW / 2;
const R_PX = 150;          // the outer, labelled ring
const DOT_R = 12;

/**
 * The ring every space in this set is scaled against.
 *
 * One ring for the whole set, so the radii are comparable with each other and
 * with the label on the circle.
 */
function ringOf(vLat, vLng, listings) {
  const ds = (Array.isArray(listings) ? listings : []).map((l) => {
    const d = num(l?.d);
    if (Number.isFinite(d) && d > 0) return d;
    // Fall back to the offset's own length rather than trusting num()'s NaN.
    const o = offsetM(vLat, vLng, l?.lat, l?.lng);
    return o ? Math.hypot(o.e, o.n) : 0;
  });
  return ringFor(ds.length ? Math.max(...ds) : 0);
}

/**
 * The spaces that get a dot: the ones whose direction we can actually state.
 *
 * WHY SOME SPACES ARE NOT PLOTTED, which is a correctness rule and not a
 * cosmetic one. bearingWord() refuses to name a direction below
 * DIRECTION_MIN_M because a 45-degree sector is narrower than the pin error at
 * that range. The first version of this function then went ahead and drew
 * those spaces at a specific bearing anyway — so the page declined to write
 * "north-east" in words while pointing north-east with a dot. The picture was
 * making the exact claim the prose had just refused to make.
 *
 * A space inside the floor is therefore named in the caption as being at the
 * venue, which is the true and useful thing, and gets no position. That also
 * disposes of the worst legibility problem: an 85m space in a 2km ring landed
 * six pixels from the centre and completely covered the venue marker.
 *
 * Exported separately from the SVG because this is the part worth asserting
 * against: that a space due east lands to the right of the venue and not above
 * it, and that the numbering matches the panel beneath.
 */
export function plotted(place, listings) {
  const vLat = num(place?.lat), vLng = num(place?.lng);
  if (!Number.isFinite(vLat) || !Number.isFinite(vLng)) return [];
  const ring = ringOf(vLat, vLng, listings);
  const out = [];
  (Array.isArray(listings) ? listings : []).forEach((l, i) => {
    const o = offsetM(vLat, vLng, l?.lat, l?.lng);
    if (!o) return;
    const direction = bearingWord(o.e, o.n, l?.d);
    if (!direction) return;                  // named in the caption instead
    const scale = R_PX / ring;
    let x = o.e * scale, y = -o.n * scale;   // SVG y grows downward
    const r = Math.hypot(x, y);
    // Defensive: ringFor() already picked a ring everything fits inside, but a
    // dot outside the frame would be drawn clipped and silently misread.
    if (r > R_PX) { x = (x / r) * R_PX; y = (y / r) * R_PX; }
    out.push({
      n: i + 1,
      title: l?.title || 'Private space',
      x: CX + x,
      y: CY + y,
      ring,
      direction,
    });
  });
  return out;
}

/**
 * The spaces that are at the venue: too close for a direction to be stated.
 *
 * They keep their panel numbering, because the caption names them by it.
 */
export function atVenue(place, listings) {
  const vLat = num(place?.lat), vLng = num(place?.lng);
  if (!Number.isFinite(vLat) || !Number.isFinite(vLng)) return [];
  const out = [];
  (Array.isArray(listings) ? listings : []).forEach((l, i) => {
    const o = offsetM(vLat, vLng, l?.lat, l?.lng);
    if (!o) return;
    if (bearingWord(o.e, o.n, l?.d)) return;
    out.push({ n: i + 1, title: l?.title || 'Private space' });
  });
  return out;
}

/** "1", "1 and 2", "1, 2 and 3" — for the caption. */
export const numberList = (ns) =>
  (ns.length <= 1 ? String(ns[0] ?? '')
    : `${ns.slice(0, -1).join(', ')} and ${ns[ns.length - 1]}`);

/**
 * A plain-words description of the whole diagram.
 *
 * This is the SVG's aria-label, so a screen reader gets the same information
 * the picture carries rather than "image". It is also the only part of the
 * graphic a search engine can read, which is the second reason it is a
 * sentence rather than a list of coordinates.
 */
export function mapAltText(place, pts, near = []) {
  const name = place?.venue_name || place?.name || 'the venue';
  const total = pts.length + near.length;
  if (!total) return `Diagram of the area around ${name}.`;
  const bits = pts.map(p => `${p.n} to the ${p.direction}`);
  if (near.length) {
    bits.push(`${numberList(near.map(p => p.n))} at ${name} itself`);
  }
  return `Diagram showing ${total} bookable space${total === 1 ? '' : 's'} `
    + `around ${name}: ${bits.join(', ')}.`;
}

/**
 * The graphic, or '' when there is nothing honest to draw.
 *
 * '' rather than an empty frame: a ring with no venue in it is worse than no
 * picture, and the caller already omits the whole block when the venue has no
 * coordinates.
 */
export function venueMap(place, listings) {
  const vLat = num(place?.lat), vLng = num(place?.lng);
  if (!Number.isFinite(vLat) || !Number.isFinite(vLng)) return '';

  const pts = plotted(place, listings);
  const near = atVenue(place, listings);
  const ring = pts.length ? pts[0].ring : ringOf(vLat, vLng, listings);
  const half = ring / 2;
  const name = place?.venue_name || place?.name || 'the venue';

  const dots = pts.map(p => `
    <g>
      <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${DOT_R}"
              fill="#2ED3C6" stroke="#06231f" stroke-width="2"/>
      <text x="${p.x.toFixed(1)}" y="${(p.y + 4).toFixed(1)}" text-anchor="middle"
            font-family="system-ui,sans-serif" font-size="12" font-weight="700"
            fill="#06231f">${p.n}</text>
    </g>`).join('');

  // THE VENUE MARKER IS DRAWN LAST, ON TOP OF THE DOTS. A space just over the
  // direction floor in a 2km ring sits about eleven pixels from the centre, so
  // whichever is painted second wins — and the one thing the diagram cannot
  // afford to lose is where the venue is.
  const venueMarker = `
      <circle cx="${CX}" cy="${CY}" r="7" fill="#EAF1F8" stroke="#0a111e" stroke-width="2"/>
      <text x="${CX}" y="${CY + 26}" text-anchor="middle"
            font-family="system-ui,sans-serif" font-size="12" font-weight="600"
            fill="rgba(234,241,248,.75)">Venue</text>`;

  // aria-hidden on the drawing itself: the whole <svg> carries one label, so a
  // screen reader must not also announce the decorative pieces inside it.
  const svg = `<svg viewBox="0 0 ${VIEW} ${VIEW}" width="${VIEW}" height="${VIEW}"
       role="img" aria-label="${esc(mapAltText(place, pts, near))}"
       style="display:block;width:100%;height:auto;max-width:${VIEW}px;margin:0 auto">
    <g aria-hidden="true">
      <circle cx="${CX}" cy="${CY}" r="${R_PX}" fill="rgba(46,211,198,.05)"
              stroke="rgba(46,211,198,.45)" stroke-width="1.5"/>
      <circle cx="${CX}" cy="${CY}" r="${R_PX / 2}" fill="none"
              stroke="rgba(46,211,198,.28)" stroke-width="1" stroke-dasharray="4 5"/>
      <text x="${CX}" y="${CY - R_PX - 8}" text-anchor="middle"
            font-family="system-ui,sans-serif" font-size="12"
            fill="rgba(234,241,248,.6)">${esc(ringLabel(ring))}</text>
      <text x="${CX}" y="${CY - R_PX / 2 - 6}" text-anchor="middle"
            font-family="system-ui,sans-serif" font-size="11"
            fill="rgba(234,241,248,.42)">${esc(ringLabel(half))}</text>
      <text x="${VIEW - 16}" y="26" text-anchor="end"
            font-family="system-ui,sans-serif" font-size="13" font-weight="700"
            fill="rgba(234,241,248,.55)">N &uarr;</text>
      ${dots}
      ${venueMarker}
    </g>
  </svg>`;

  // The caption carries the spaces the drawing deliberately has no dot for.
  const atVenueLine = near.length
    ? ` ${near.length === 1 ? 'Space' : 'Spaces'} ${esc(numberList(near.map(p => p.n)))}
        ${near.length === 1 ? 'is' : 'are'} at ${esc(name)} itself.`
    : '';
  const caption = pts.length
    ? `Where the spaces below are, relative to ${esc(name)} &mdash; direction and
       distance only, not a street map. Numbers match the list.${atVenueLine}`
    : `Distances on this page are measured from ${esc(name)}.${atVenueLine}`;

  return `<div class="mapwrap">${svg}</div>
  <p style="color:var(--faint);font-size:12px;margin:8px 0 0">${caption}</p>`;
}

// BRINGING A REAL STREET MAP BACK. When the Maps Static API is enabled on the
// Google project that owns VITE_GOOGLE_MAPS_KEY and the project has billing,
// the licensed version is:
//
//   https://maps.googleapis.com/maps/api/staticmap
//     ?center=LAT,LNG&zoom=14&size=620x320&scale=2
//     &markers=color:0x2ED3C6|LAT,LNG&key=KEY
//
// maps.googleapis.com is already in img-src, so no CSP change is needed. Two
// things must be true before it ships, and neither is true today:
//
//   1. The API is actually enabled. An `<img>` at a disabled API is a 403 — a
//      broken image on an indexed page, which is the bug this file replaced.
//      So it needs a verified-once check, not a key check: a key being present
//      says nothing about whether the API behind it is on.
//   2. Somebody has agreed to the per-request cost. These are low-traffic
//      pages and the bill would be small, but it is not zero and it is not
//      mine to assume.
//
// This diagram should stay underneath it either way: it is the thing that says
// WHICH of the listed spaces is where, which a single-marker street map does
// not.

export default venueMap;
