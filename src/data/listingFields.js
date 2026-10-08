// The columns the booking path reads — in one place, because two of them going
// missing was a live bug nobody could see.
//
// WHAT WENT WRONG. BookingSheet mirrors the checkout API's refusals so a driver
// is told on the date picker instead of after they have typed a registration
// and tapped Pay. Its own comment says so:
//
//   "The API already refuses a date the site never agreed to. Mirroring it here
//    means the driver is told while they're still on the date picker."
//
// That mirror reads listing.available_days, listing.extra_dates and
// listing.blocked_dates. The map query — the primary way anybody finds a space
// — selected an explicit list of columns that did not include any of the three.
// So on the map path dateIsOpen() saw `undefined`, treated every day as open,
// and the driver was bounced at the card form by the exact refusal the mirror
// exists to prevent. On the Rent tab, which uses select('*'), it worked
// perfectly. Nothing threw, and nothing in the UI looked wrong.
//
// min_notice_hours arrived with the same hole: the lead-time guard went into
// api/checkout/create-session.js and the column was never added here, so the
// one listing that needs 24 hours' notice refused the sale server-side with
// nothing client-side ever saying so.
//
// THE LIST IS THE FIX, AND THE TEST IS THE GUARD.
// tests/unit/bookingColumns.test.mjs brace-matches BookingSheet out of
// App.jsx, pulls every `listing.<field>` it reads, and requires each one to be
// below. Add a field to the sheet without adding it here and the suite fails
// rather than a driver finding out at the card form.

/**
 * Everything the map/search query must select for the booking path to work.
 *
 * NOT `select('*')`. These rows carry access_method, access_contact_phone and
 * instructions — how to get through a locked gate and whose mobile to ring —
 * and supabase/migrations/20260728_security_and_integrity.sql exists precisely
 * to keep those off a public read. An explicit list is what makes that
 * reviewable; the problem was never that it was explicit, only that it was
 * incomplete.
 *
 * org_registration is deliberately absent. It is a free-text field whose own
 * placeholder invites `"none — explain"`, so it can hold a sentence rather
 * than a register number, and it is shown in the admin approval queue where a
 * human reads it. "Verified club" plus the operator's name is the credibility
 * a driver can actually use.
 */
export const BOOKING_COLUMNS = [
  // Identity and placement.
  'id', 'title', 'address', 'lat', 'lng', 'photos', 'instructions',
  'space_type', 'featured', 'spaces',
  // Price. Both rates: a day-priced site has no hourly figure at all.
  'price_per_hour', 'price_per_day',
  // The availability window, all five columns. dateIsOpen() reads every one.
  'available_from', 'available_until', 'available_days', 'extra_dates', 'blocked_dates',
  // The gate window, and what it costs to leave a car in past closing.
  'gate_opens_at', 'gate_closes_at', 'overnight_fee_pence',
  // How much notice this site needs. 0 on five of the six live listings.
  'min_notice_hours',
  // Trust signals that already existed.
  'is_verified', 'verified_org_type',
  'average_rating', 'ratings_count', 'completed_bookings_count',
  // Who actually runs the site — see operatorFacts() below.
  'org_name', 'org_type',
];

/** The PostgREST/`supabase.select()` form. */
export const BOOKING_SELECT = BOOKING_COLUMNS.join(',');

const ORG_TYPE_LABEL = { club: 'club', church: 'church', school: 'school', other: 'organisation' };

/**
 * What we can honestly tell a driver about who runs this car park.
 *
 * WHY NOT REVIEWS. Every comparable in the audit leans on ratings. ParkEasy
 * has taken two real bookings in its life, so it has no ratings and cannot
 * honestly manufacture any — TrustRow already renders nothing at all on every
 * live listing, which is the whole problem. What ParkEasy does have, and a
 * driveway marketplace does not, is the site itself: a named club or school, a
 * known number of spaces, published gate hours.
 *
 * EVERY LINE IS A COLUMN, NEVER AN INFERENCE. In particular nothing here says
 * "marshalled" or "staffed": there is no column for it, several of these sites
 * are volunteer-run, and a driver who reads "marshalled" and arrives to an
 * empty yard has been told something we invented.
 *
 * @returns {Array<{k:string, text:string}>} empty when we know nothing
 */
export function operatorFacts(listing) {
  const l = listing || {};
  const out = [];

  const org = String(l.org_name || '').trim();
  if (org) {
    const type = ORG_TYPE_LABEL[String(l.org_type || '').toLowerCase()];
    out.push({ k: 'operator', text: type ? `Run by ${org}, a local ${type}` : `Run by ${org}` });
  }

  // Only above one. "1 space on site" is what a driveway is, and saying it
  // reads as a warning rather than a fact.
  const spaces = Number(l.spaces);
  if (Number.isFinite(spaces) && spaces > 1) {
    out.push({ k: 'spaces', text: `${spaces} spaces on site` });
  }

  const open = String(l.gate_opens_at || '').slice(0, 5);
  const close = String(l.gate_closes_at || '').slice(0, 5);
  if (open && close) out.push({ k: 'gates', text: `Gates open ${open}–${close}` });

  const notice = Number(l.min_notice_hours);
  if (Number.isFinite(notice) && notice > 0) {
    out.push({
      k: 'notice',
      text: notice % 24 === 0 && notice >= 24
        ? `Book ${notice / 24} day${notice === 24 ? '' : 's'} ahead`
        : `Book ${notice} hour${notice === 1 ? '' : 's'} ahead`,
    });
  }

  if (l.is_verified) {
    out.push({ k: 'verified', text: `Verified ${ORG_TYPE_LABEL[l.verified_org_type] || 'host'}` });
  }

  // Ratings last, and only at three or more: one review should not define a
  // host. This rule predates this file — it is TrustRow's, kept deliberately.
  const n = Number(l.ratings_count);
  if (n >= 3 && Number(l.average_rating) > 0) {
    out.push({ k: 'rating', text: `${Number(l.average_rating).toFixed(1)} out of 5 from ${n} ratings` });
  }

  const done = Number(l.completed_bookings_count);
  if (Number.isFinite(done) && done > 0) {
    out.push({ k: 'completed', text: `${done} booking${done === 1 ? '' : 's'} completed here` });
  }

  return out;
}
