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

export const BOOKABLE_SPACES = [
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
  // Belfast Royal Academy (£15/day, £17.25 all-in, 64 spaces, Cliftonville
  // Road BT14 6JL) is deliberately ABSENT: it is still pending_approval, so it
  // cannot be booked. Add it the moment it goes active — it is the bigger of
  // the two by some margin.
];

/** Active bookable spaces for one area page, e.g. 'belfast'. */
export const spacesForArea = (areaSlug) =>
  BOOKABLE_SPACES.filter(s => s.area === areaSlug);

export const gbp = (pence) => `£${(pence / 100).toFixed(2)}`;

export default BOOKABLE_SPACES;
