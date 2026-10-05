// What a listing must have before it can be published — ONE copy of it.
//
// There were two. api/publish-listing.js held the enforcement and App.jsx held
// a hand-kept twin called checkRequirements(), and the twin is how the last
// change to this rule quietly did nothing: the server gate was lowered for
// organisations (one photo, no registration number, no access write-up — see
// approvalChecklist below for where those went) and the form in front of the
// host went on demanding all of it. The parish treasurer still could not get
// past the checklist. The server was ready to accept a listing the UI would
// not let them submit.
//
// So both import this. A divergence is now impossible rather than merely
// discouraged, and publishGate.test.mjs fails if App.jsx grows a second copy.
//
// Dependency-free so Node can drive it directly, the same reason parkedCore and
// eventDemandCore exist.

// Floor for a listing's hourly rate. Anything under this can't reach the £4
// minimum booking in a sensible number of hours.
export const MIN_PRICE_PER_HOUR = 1.5;
// A day rate is a different shape of thing, not 24 x the hourly one: the sites
// that use it are clubs and schools selling a fixed gate window for a matchday.
// Davitt Park is £20 and Belfast Royal Academy £15, so the floor is set below
// both — it exists to catch a typo (£3 for a whole day), not to set the market.
export const MIN_PRICE_PER_DAY = 5;

/** Photos needed to publish. See the comment on the org/residential split below. */
export const minPhotosFor = (l) => (l && l.host_type === 'organization' ? 1 : 2);

/**
 * WHY AN ORGANISATION'S BAR IS LOWER THAN A DRIVEWAY'S rather than higher.
 *
 * It used to be the other way round: twelve requirements to seven. Four photos
 * instead of two, a legal name, an organisation type, a registration number, a
 * named access contact with a mobile, and thirty characters of access method.
 * That is the form put in front of a GAA club treasurer or a parish secretary —
 * precisely the host worth more than fifty driveways, and the one least likely
 * to finish a long form on a phone.
 *
 * It was doing that for nothing, because an organisation listing does not go
 * live when it is published: it goes to `pending_approval` and emails the
 * founder, who reads every one. The gate demanded things immediately before a
 * human review that exists to ask for exactly those things.
 *
 * They are not dropped — approvalChecklist() returns them for that review. A
 * residential listing keeps the full gate, because that one DOES go live
 * immediately and the gate is the only thing standing in front of it.
 *
 * Competitors put the bar in the same place: JustPark publishes on postcode,
 * type, access note, availability, price and a photo, then reviews within a day
 * or two; SpotHero's independent-seller route is a short form and a human who
 * replies. Neither gates on nine fields up front.
 */
export function listingRequirements(l) {
  const missing = [];
  const listing = l || {};
  const photos = listing.photos || [];
  const isOrg = listing.host_type === 'organization';
  const minPhotos = minPhotosFor(listing);
  if (photos.length < minPhotos) missing.push(`${minPhotos - photos.length} more photo${minPhotos - photos.length !== 1 ? 's' : ''} (min ${minPhotos})`);
  if (photos.length > 10) missing.push('Maximum 10 photos');
  if ((listing.instructions || '').trim().length < 30) missing.push(`"How to find it" too short — ${(listing.instructions || '').trim().length}/30 characters`);
  if (listing.lat == null || listing.lng == null) missing.push('Verified address (pick a suggestion)');
  // A listing needs at least one rate and may carry both. Each is checked on
  // its own: publishing a sound hourly rate alongside a mistyped day rate has
  // to fail, or the day rate goes live at the typo.
  if (!(listing.price_per_hour ?? listing.price_per_day ?? listing.price_per_month)) missing.push('A price');
  if (listing.price_per_hour != null && Number(listing.price_per_hour) < MIN_PRICE_PER_HOUR) missing.push(`Hourly price of at least £${MIN_PRICE_PER_HOUR.toFixed(2)}`);
  if (listing.price_per_day != null && Number(listing.price_per_day) < MIN_PRICE_PER_DAY) missing.push(`Day price of at least £${MIN_PRICE_PER_DAY.toFixed(2)}`);
  // Both rates are allowed, but the day rate has to beat buying the same hours
  // one at a time or it is a worse deal that the sheet still offers as "all day".
  if (Number(listing.price_per_hour) > 0 && Number(listing.price_per_day) > 0
      && Number(listing.price_per_day) <= Number(listing.price_per_hour)) {
    missing.push('Day price higher than the hourly price');
  }
  if (!listing.availability) missing.push('Availability preset');
  if (!(listing.contact_phone || '').trim()) missing.push('Your mobile number');
  const cap = listing.spaces ?? 1;
  if (!(cap >= 1 && cap <= 200)) missing.push('Capacity between 1 and 200');
  if (listing.space_type === 'ev_charger') {
    const a = listing.amenities || [];
    if (!a.some(x => String(x).startsWith('speed:'))) missing.push('Charger speed');
    if (!a.some(x => String(x).startsWith('connector:'))) missing.push('Connector type');
  }
  if (isOrg) {
    // Who they are still blocks: it is the one thing the founder cannot work
    // out from the listing, and it decides whether this is a club car park or
    // somebody letting a field they do not own.
    if (!(listing.org_name || '').trim()) missing.push('Organization legal name');
    if (!listing.org_type) missing.push('Organization type');
  }
  return missing;
}

/**
 * The things a published organisation listing still owes — for the founder's
 * approval queue, and shown to the host as "we'll ask you for these", never as
 * a blocker.
 *
 * These were publish blockers. They are all questions a human asks better than
 * a validator does: "no registration number" is a real answer for a parish
 * hall, and a one-line access note is fine if the answer is genuinely "gate is
 * open, park anywhere". Returned so the approval screen, the notification email
 * and the form itself can list them, and so nothing quietly stops being asked.
 */
export function approvalChecklist(l) {
  if (!l || l.host_type !== 'organization') return [];
  const owed = [];
  const photos = l.photos || [];
  if (photos.length < 4) owed.push(`${4 - photos.length} more photo${4 - photos.length !== 1 ? 's' : ''} (4 is the bar for an organisation)`);
  if (!(l.org_registration || '').trim()) owed.push('Registration number (or "none" with a reason)');
  if (!(l.access_contact_name || '').trim() || !(l.access_contact_phone || '').trim()) owed.push('Named access contact (name + mobile)');
  if ((l.access_method || '').trim().length < 30) owed.push('Fuller access method — how a driver actually gets in');
  return owed;
}
