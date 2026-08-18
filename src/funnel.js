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
