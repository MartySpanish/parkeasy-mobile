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
//
// paused: a site that is off sale right now but expected back. Both sites went
// off on 10 August — the events they were signed for are over, and on 8 August
// two drivers paid for Davitt Park and found the gates locked because the club
// had thirteen hours' notice on a Friday night. Selling a space nobody has
// agreed to open is worse than selling nothing. The records stay so bringing
// either back is deleting one line, not rebuilding the entry.

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
    // 'day' was wrong twice over. The gates open at 9am and lock at 8.30pm, so
    // this is an 11-and-a-half-hour visit, not a day — and calling it a day
    // invited the one comparison ParkEasy loses, a city-centre multi-storey
    // day rate. 'visit' is both more accurate and the frame a matchday driver
    // is actually in.
    unit: 'visit',
    hours: '9am–8.30pm',
    lat: 54.5875, lng: -5.9625,
    photo: 'https://parkeasy.uk/davitts/1-car-park.jpg',
    // Back on sale 13 Aug. It came off after the 8 August bookings were sold on
    // thirteen hours' notice to a volunteer-run club that never opened the
    // gates. The email that failed has since been rebuilt to lead with "OPEN
    // THE GATES" and the date, and it now reaches the treasurer as well as the
    // secretary — so the specific failure is addressed. The general one is not:
    // there is still no minimum notice period, so a 9am Saturday slot can still
    // be sold at quarter to eight the night before.
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
    unit: 'visit',
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
    // Off sale from 10 Aug, ahead of that date. The licence was a Fleadh
    // arrangement and the Fleadh is finished; the Academy has never taken a
    // booking, so nothing is lost by stopping now rather than on the 21st.
    //
    // KEEP THIS PAUSED EVEN THOUGH rental_listings.status IS NOW 'active'.
    // The build warning below this file's rule says "Check rental_listings
    // .status matches", and from 19 Aug it no longer does — deliberately. BRA
    // was made active so it is VISIBLE in the app, and its availability window
    // was closed (available_until 2026-08-18) so it CANNOT be booked. Live and
    // sellable came apart, and the header rule above — "only ever list a space
    // whose status is 'active'" — was written before that was possible.
    //
    // The rule that actually matters is the sentence after it: advertising a
    // space that cannot be booked is worse than advertising nothing. Un-pausing
    // this would put "£17.25 all-in" on an indexed page for a car park that
    // refuses every booking date, which is the wasted click that rule forbids
    // AND a price shown to a consumer for something not for sale. Un-pause it
    // when the Academy agrees a real window, and set that window in
    // rental_listings at the same time — not before.
    paused: true,
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

// ── THE HEADLINE PRICE ──────────────────────────────────────────────────────
// What the homepage says out loud, e.g. "from £X". Set it HERE.
//
// WHY IT IS NO LONGER DERIVED. It used to be the cheapest all-in price across
// the sellable listings, which sounds sensible and is not: with one live site
// it meant Michael Davitt GAC alone set the headline for the whole product.
// The number that reached the homepage was "from £23.00 a day" — more than a
// city-centre multi-storey, for a space in west Belfast, chosen by nobody.
//
// null = fall back to the derived figure, which is the old behaviour and the
// safe default when there is nothing to say.
//
// THE GUARD BELOW IS THE POINT. A headline lower than anything actually on
// sale is an advert for a price nobody can pay. That has already happened
// once: the first draft of the homepage said "from £17.25", which was Belfast
// Royal Academy's rate while the Academy was off sale. So a configured
// headline is only used when a real listing meets or beats it; otherwise the
// build falls back to the true cheapest and says so in the log.
export const HEADLINE_PENCE = null;

/** Still sellable on the given day: not paused, and inside its window. */
export const isSellable = (s, today = todayYmd()) =>
  !s.paused && (!s.bookableUntil || today <= s.bookableUntil);

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

/** Dropped — paused or past their window. Reported at build time, never silent. */
export const EXPIRED_SPACES = ALL_SPACES.filter(s => !isSellable(s));

/** Active bookable spaces for one area page, e.g. 'belfast'. */
export const spacesForArea = (areaSlug) =>
  BOOKABLE_SPACES.filter(s => s.area === areaSlug);

export const gbp = (pence) => `£${(pence / 100).toFixed(2)}`;

/**
 * The figure the homepage shows, and the unit to show it in.
 *
 * Returns null when there is nothing bookable — the homepage then leads with
 * the free-spot product instead, which is the honest thing to do with an empty
 * shelf.
 *
 * @returns {{pence:number, text:string, unit:string, derived:boolean, warning?:string}|null}
 */
export function headline(spaces = BOOKABLE_SPACES) {
  if (!spaces.length) return null;
  const cheapest = Math.min(...spaces.map(s => s.allInPence));
  // Every sellable listing shares a unit today. If that ever stops being true,
  // the headline says "visit" rather than inventing a blended unit.
  const units = new Set(spaces.map(s => s.unit));
  const unit = units.size === 1 ? [...units][0] : 'visit';

  if (HEADLINE_PENCE == null) {
    return { pence: cheapest, text: gbp(cheapest), unit, derived: true };
  }
  if (HEADLINE_PENCE < cheapest) {
    // Configured below anything on sale. Refuse it rather than advertise it.
    return {
      pence: cheapest, text: gbp(cheapest), unit, derived: true,
      warning: `HEADLINE_PENCE is ${gbp(HEADLINE_PENCE)} but the cheapest bookable space is `
        + `${gbp(cheapest)}. Advertising a price nobody can pay is how "from £17.25" happened. `
        + `Using ${gbp(cheapest)} instead — lower a listing's price to move the headline.`,
    };
  }
  return { pence: HEADLINE_PENCE, text: gbp(HEADLINE_PENCE), unit, derived: false };
}

export default BOOKABLE_SPACES;
