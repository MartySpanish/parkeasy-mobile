// The four events that measure whether the app does its job.
//
// WHY THIS FILE EXISTS. The homepage was about to be optimised with no
// instrumentation on the action it exists to produce. Bookings and Premium are
// counted because money moves; everything before them — did they search, did
// they get a usable answer, did they act on it — was invisible. That is the
// whole funnel, and it was guesswork.
//
// FOUR EVENTS, NOT FORTY. Each one is a step a driver either takes or does
// not, and the ratios between them say where the product leaks:
//
//   search     → someone asked the question the app exists to answer
//   spot_open  → the answers were relevant enough to look at one
//   directions → the app delivered; this is the real conversion
//   signup     → they chose to come back
//
// search → spot_open measures RESULT QUALITY. spot_open → directions measures
// whether the spot page closes. Neither was knowable before.
//
// NO PERSONAL DATA, EVER. Vercel Analytics is cookieless and these payloads
// carry only counts and short enums — never a spot id tied to a person, never
// a query string, never coordinates. Where someone parks is not ours to log.
import { track } from '@vercel/analytics';

// Off Vercel (localhost, Capacitor, GitHub Pages) this must do nothing at all
// rather than throw into a driver's session over a metric.
const live = () => {
  try {
    return typeof window !== 'undefined' && !window.Capacitor
      && /(vercel\.app|parkeasy\.uk)$/.test(window.location.hostname);
  } catch { return false; }
};

const send = (name, props) => {
  if (!live()) return;
  try { track(name, props); } catch { /* never break the app for a metric */ }
};

/** A search resolved. `via` distinguishes the paths so they can be compared. */
export const trackSearch = (via) => send('search', { via });

/** A spot detail was opened. `kind` is the badge, so relevance can be read by type. */
export const trackSpotOpen = (kind) => send('spot_open', { kind: kind || 'unknown' });

/** Directions tapped — the moment the app actually delivered. */
export const trackDirections = (kind) => send('directions', { kind: kind || 'unknown' });

/** An account was created. `from` says which prompt earned it. */
export const trackSignup = (from) => send('signup', { from: from || 'unknown' });

// ── The free → paid funnel ───────────────────────────────────────────────────
//
// THE QUESTION THESE FOUR ANSWER, and it is the only one that decides whether
// the free spots are an asset or a liability: does somebody who came for a free
// space ever pay for one?
//
// If they do, the 745 hand-checked free spots are the top of the marketplace
// funnel and every hour spent on them pays for itself. If they never do, the
// free spots are cannibalising the thing that makes money and the answer is a
// different product, not more spots. Nobody could tell before, in either
// direction, which is an expensive thing not to know.
//
//   hotspot_viewed            → someone opened a free spot
//   funnel_card_shown         → we had a paid alternative worth showing
//   paid_listing_clicked      → they were interested enough to look
//   booking_completed_from_hotspot → they paid
//
// Same privacy rule as everything above: counts and short enums only. `taken`
// and `walk_min` are buckets, not a location.

/** A free or hidden-gem spot was opened. */
export const trackHotspotViewed = (kind, taken) =>
  send('hotspot_viewed', { kind: kind || 'unknown', taken: taken ? 'yes' : 'no' });

/** A paid alternative existed near a free spot and was shown beside it. */
export const trackFunnelCardShown = (reason, walkMin) =>
  send('funnel_card_shown', { reason: reason || 'nearby', walk_min: bucket(walkMin) });

/** The driver tapped through to the paid space. */
export const trackPaidListingClicked = (reason, walkMin) =>
  send('paid_listing_clicked', { reason: reason || 'nearby', walk_min: bucket(walkMin) });

/**
 * A booking completed that started at a free spot.
 *
 * Fired on the return from Stripe. The AUTHORITATIVE number is
 * bookings.from_hotspot, written server-side from checkout metadata — a client
 * event after a redirect is lost every time somebody closes the tab on the
 * Stripe receipt page, which is exactly when a booking is most complete.
 * This one exists so the analytics funnel has an end; the dashboard reads the
 * database.
 */
export const trackBookingFromHotspot = () => send('booking_completed_from_hotspot', {});

// ── Carrying "this started at a free spot" through checkout ──────────────────
//
// Between tapping the paid space on the comparison card and paying for it, a
// driver passes through a spot sheet, a booking sheet and a hosted Stripe page.
// Threading a prop through all of that would touch half the app for one boolean.
//
// A short-lived sessionStorage mark instead. Session-scoped so it dies with the
// tab, and time-boxed so a card tapped this morning cannot attribute a booking
// made this afternoon — an attribution that never expires eventually claims
// credit for everything.
const HOTSPOT_ORIGIN_KEY = 'pe_from_hotspot_at';
const HOTSPOT_ORIGIN_TTL_MS = 30 * 60 * 1000;

export const markHotspotOrigin = () => {
  try { sessionStorage.setItem(HOTSPOT_ORIGIN_KEY, String(Date.now())); } catch { /* private mode */ }
};

export const cameFromHotspot = () => {
  try {
    const t = Number(sessionStorage.getItem(HOTSPOT_ORIGIN_KEY) || 0);
    return t > 0 && Date.now() - t < HOTSPOT_ORIGIN_TTL_MS;
  } catch { return false; }
};

export const clearHotspotOrigin = () => {
  try { sessionStorage.removeItem(HOTSPOT_ORIGIN_KEY); } catch { /* private mode */ }
};

// Walk minutes as a bucket. An exact figure plus a timestamp is a location.
const bucket = (m) => (m == null ? 'unknown' : m <= 3 ? '0-3' : m <= 6 ? '4-6' : m <= 10 ? '7-10' : '10+');
