// Bookable inventory, for the static area pages.
//
// WHY THIS FILE EXISTS. /area/*.html are static, pre-rendered pages served
// without JavaScript — they are what Google actually reads. Until now they
// named Victoria Square, CastleCourt, Q-Park, NCP, Titanic and the SSE, and
// did not mention a single space we can sell. Every post pointing at that
// domain landed people on free advertising for our competitors.
//
// The listings live in Supabase, but a static page cannot query it at build
// time reliably (the connector is regularly unavailable, and a build must not
// fail because of that). So ACTIVE, BOOKABLE spaces are mirrored here.
//
// KEEP IN SYNC. When a listing goes live or comes down, update this file.
// Only ever list a space whose status is 'active' — advertising a space that
// cannot be booked is worse than advertising nothing, because the click is
// wasted and the visitor learns the site does not work.
//
// allInPence is what the DRIVER pays: day rate + the driver service fee, per
// api/_pricing.js. DMCCA 2024 s.230 requires the all-in figure wherever a
// price is shown to a consumer, and a search-engine snippet is exactly that.
//
// bookableUntil (yyyy-mm-dd, inclusive) mirrors rental_listings.available_until
// for sites whose licence has an end date. A static page cannot notice that a
// window closed, so without this the Academy would have gone on advertising
// itself — with a price — past the last day anyone could book it. That is the
// precise failure this file's own rule above forbids, and "remember to edit
// the file" is not a mechanism. The build filters on it instead.

const ALL_SPACES = [
  {
    slug: 'davitt-park',
    area: 'belfast',                 // must match the /area/<slug>.html filename
    name: 'Michael Davitt GAC — Davitt Park',
    address: "Davitt Park, 47 St Mary's Gardens, Belfast",
    postcode: 'BT12 7LG',
    spaces: 15,
    pricePence: 2000,                // £20 per vehicle per day, set by the club
    allInPence: 2300,                // £23.00 — what the driver is charged
    unit: 'day',
    hours: '9am–8.30pm',
    lat: 54.5875, lng: -5.9625,
    photo: 'https://parkeasy.uk/davitts/1-car-park.jpg',
  },
  {
    slug: 'belfast-royal-academy',
    area: 'belfast',
    name: 'Belfast Royal Academy — Cliftonville Road',
    address: 'Belfast Royal Academy, Cliftonville Road, Belfast',
    postcode: 'BT14 6JL',
    spaces: 64,
    pricePence: 1500,                // £15 per vehicle per day, set by the school
    allInPence: 1725,                // £17.25 — what the driver is charged
    unit: 'day',
    hours: '8am–5pm, Mon–Fri',       // clause 3 of the licence; weekends locked
    lat: 54.6180, lng: -5.9450,
    photo: 'https://parkeasy.uk/bra/1-front-bays.jpg',
    // The licence is headed "Fleadh Cheoil na hÉireann 2026" and clause 3 gives
    // 8am–5pm Monday to Friday. Clause 2 has no end date, so on its face it
    // runs into the new school year — 64 strangers' cars at the front of a
    // working grammar school at 8am. Bounded to the last weekday of the
    // holidays until the Academy confirms it wants to continue. Extend the
    // date here and in rental_listings.available_until together.
    bookableUntil: '2026-08-21',
  },
  // 5 Manor Close is the third ACTIVE listing and is deliberately ABSENT.
  // Two reasons, both about it being someone's home rather than an
  // institution: publishing a private residential address on a static page
  // built to be indexed by Google is a different act from listing it inside
  // the app, and it is priced hourly (£3/hr) with no day rate, so it has no
  // honest all-in day figure to show in this format. In the app, unchanged.
];

/** Today in Belfast as yyyy-mm-dd — the date a driver reading the page is on. */
const todayYmd = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

/** Still sellable on the given day (inclusive of bookableUntil). */
export const isSellable = (s, today = todayYmd()) =>
  !s.bookableUntil || today <= s.bookableUntil;

/**
 * Everything we can actually sell as of this build.
 *
 * Evaluated at BUILD time, which is the honest thing a static page can do:
 * the pages are regenerated on every deploy, so an expired licence drops off
 * the next time anything ships. It is not instant — if nothing deploys for a
 * fortnight the page is a fortnight stale — so a window that matters should
 * still be taken out of Supabase, where checkout enforces it in real time.
 * This stops the page ADVERTISING it; available_until stops the sale.
 */
export const BOOKABLE_SPACES = ALL_SPACES.filter(s => isSellable(s));

/** Dropped for being past their window — reported at build time, never silent. */
export const EXPIRED_SPACES = ALL_SPACES.filter(s => !isSellable(s));

/** Active bookable spaces for one area page, e.g. 'belfast'. */
export const spacesForArea = (areaSlug) =>
  BOOKABLE_SPACES.filter(s => s.area === areaSlug);

export const gbp = (pence) => `£${(pence / 100).toFixed(2)}`;

export default BOOKABLE_SPACES;
