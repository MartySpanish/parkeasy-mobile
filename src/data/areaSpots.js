// Which of a town's spots go on its /area page, in what order, and where the
// CTA points.
//
// WHY THIS IS A MODULE AND NOT PART OF THE BUILD SCRIPT. It started inside
// scripts/inject-area-spots.mjs, and the mutation pass found the hole that
// put it here: deleting `isPublishable` from the filter — which publishes every
// hidden gem in the town to an indexed page, permanently, and gives away the
// thing nine people pay for — SURVIVED the whole test file.
//
// It survived because the only check that could see it read the BUILT pages in
// dist/, and a test run does not rebuild. So the assertion passed against
// output from the previous good build while the source was wrong. A guard that
// only fires after a deploy is not a guard.
//
// Here the rules can be called directly, with a fixture, and a gem in the
// output fails in milliseconds with no build at all.
import { isPublishable } from './publicSpots.js';

/**
 * How many spots one page lists.
 *
 * Belfast has 71 publishable spots and its page already carries the booking
 * block and ~475 words of prose; seventy-one more rows would bury both. Every
 * other town is at or under 18, so this caps Belfast and a handful of others,
 * and the copy says "14 of the 17" rather than truncating quietly.
 */
export const LIMIT = 14;

/**
 * Ordering tiers. A named multi-storey with published hours is more use to
 * somebody reading "parking in Ballymena" than an unnamed stretch of kerb, and
 * there is no popularity signal here worth ranking on — `votes` is seed weight,
 * as src/data/spotRanking.js sets out at length.
 */
export const TIER = { official: 0, paid: 1, timed: 2 };

/**
 * One town's publishable spots, in page order.
 *
 * `_city` is the key a spot was filed under, and generate-globe-data.mjs notes
 * that those keys ARE slugs — which is why this matches on the slug rather
 * than on a town NAME. Matching by name made Derry look empty: the dataset
 * calls that town "Derry~Londonderry".
 *
 * De-duplicated by name, because the same lay-by is sometimes filed under two
 * towns and a page listing it twice reads as padding.
 *
 * ISPUBLISHABLE IS NOT OPTIONAL. It is the only thing standing between a
 * hidden gem and a static page built to be crawled.
 */
export function spotsForTown(all, slug) {
  const seen = new Set();
  return (all || [])
    .filter(s => s && s._city === slug && isPublishable(s))
    .sort((a, b) =>
      (TIER[a.badge] ?? 3) - (TIER[b.badge] ?? 3)
      || String(a.name).localeCompare(String(b.name)))
    .filter(s => {
      const k = String(s.name).trim().toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

/**
 * The middle value, which one bad row cannot move.
 *
 * null AND '' ARE REJECTED BEFORE Number(). Number(null) is 0 and Number('') is
 * 0, both finite, so a spot with a missing latitude would have voted for the
 * equator. isPublishable() happens to require a finite lat/lng today, but a
 * guard that depends on its caller having already checked is not a guard — and
 * this is the second time this exact trap has appeared in this codebase
 * (see distanceLabel() in api/_eventsView.js).
 */
export const median = (ns) => {
  const a = (ns || [])
    .filter(v => v !== null && v !== undefined && v !== '')
    .map(Number).filter(Number.isFinite)
    .sort((x, y) => x - y);
  if (!a.length) return null;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

/**
 * Where the CTA points.
 *
 * `?town=<slug>` IS NOT A ROUTE. src/App.jsx parses `near` and `place` and
 * nothing else, so a town parameter lands the visitor on the generic home
 * screen — the dead end scripts/inject-area-cta.mjs's own header says no page
 * may be. So this uses the deep link that works.
 *
 * CENTRED ON THE MEDIAN OF THE SPOTS THIS PAGE LISTS. Median per axis, not
 * mean: one spot mis-filed under the wrong town drags an average into the Irish
 * Sea, and the median ignores it entirely. It is the centre of the spots we are
 * showing, which is a claim we can stand over — not a town centre nobody has
 * defined.
 *
 * @returns {string|null} null when there is nothing to centre on
 */
export function mapLink(spots, town) {
  const lat = median((spots || []).map(s => s?.lat));
  const lng = median((spots || []).map(s => s?.lng));
  if (lat == null || lng == null) return null;
  return `https://parkeasy.uk/?near=${lat.toFixed(4)},${lng.toFixed(4)}`
    + `&place=${encodeURIComponent(town || '')}`;
}

/**
 * The secondary line on a row: what we know, and nothing we do not.
 *
 * NO PRICE. The row's right-hand chip already carries it, and including it in
 * both printed every paid spot twice — "£1/hr (1st hr) … · £1/hr (1st hr) ·
 * 1100 spaces", visible to anyone who read one page.
 *
 * NO DISTANCE AND NO WALKING TIME. A destination page can say "4 min walk ·
 * 310 m" because it knows the postcode it measures from. A town page has no
 * such point, so it claims nothing.
 */
export const detail = (s) =>
  [s?.restriction, Number(s?.spaces) > 0 ? `${s.spaces} spaces` : null]
    .filter(Boolean).join(' · ');
