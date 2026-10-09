// Product analytics: the events that say whether a feature worked.
//
// HOW THIS RELATES TO funnel.js, WHICH ALREADY EXISTS. They are different
// instruments and both are kept:
//
//   funnel.js  → Vercel Analytics. Cookieless, counts and short enums only,
//                no ids. Four steps, read as a dashboard. It stays exactly as
//                it is; nothing here changes what it sends.
//   this file  → app_events in Supabase. Joinable — a row can carry a
//                listing_id, a partner_id, a value in pence — which is what
//                makes "did the people who saw a locked gem go on to pay"
//                answerable at all. Vercel Analytics cannot answer that,
//                because it deliberately holds nothing to join on.
//
// So that a feature is not instrumented twice by hand, track() below mirrors
// the four overlapping names into funnel.js itself. One call site per action.
//
// WHAT IS AND IS NOT SENT. An event carries what the product needs to make a
// decision: which listing was viewed, which partner was tapped, what a search
// that found nothing was looking for. It does NOT carry where a driver's phone
// is. The coordinates this app holds are of places people typed, never of the
// person — the same line parking_requests draws, and for the same reason.
//
// NEVER BREAKS THE APP. Every path here is wrapped and returns quietly. A
// driver's search must not fail because a metric could not be recorded.
import { supabase, isSupabaseEnabled } from './supabase.js';
import { trackSearch, trackSpotOpen, trackSignup } from './funnel.js';
import { currentSource } from './data/acquisitionSource.js';

// The allowlist is enforced server-side in log_app_event(); this copy exists so
// a typo shows up in development instead of being silently dropped in
// production. Both lists must be changed together — the migration is the one
// that decides.
const KNOWN = new Set([
  'search', 'search_no_results', 'map_move',
  'gem_view', 'gem_locked_view', 'gem_locked_rendered',
  'listing_view', 'booking_start', 'booking_paid', 'booking_abandoned',
  'heading_tap', 'parked_tap', 'spot_taken_tap',
  'partner_impression', 'partner_click',
  'premium_paywall_view', 'premium_paid',
  'submit_spot_start', 'submit_spot_done',
  'qr_landing', 'share_tap',
  'hotspot_to_booking_tap',
]);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = 'pe_session_id';

// Deliberately NOT reusing notify.js's pe_client_key. That one is allowed to
// fall back to the string 'anon' when storage is unavailable, and a shared
// 'anon' would put every private-window visitor in the world into one rate
// limit bucket. session_id is also typed uuid in the database, which 'anon'
// is not.
let cached = null;
const newId = () => {
  try {
    if (crypto?.randomUUID) return crypto.randomUUID();
  } catch { /* fall through */ }
  // Pre-2021 Safari and any insecure context: a v4-shaped id from getRandomValues,
  // and Math.random only if even that is missing. Uniqueness is all that matters
  // here — this id identifies a browsing session, not a person.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
};

export const sessionId = () => {
  if (cached) return cached;
  try {
    const stored = localStorage.getItem(KEY);
    if (stored && UUID.test(stored)) return (cached = stored);
    const fresh = newId();
    localStorage.setItem(KEY, fresh);
    return (cached = fresh);
  } catch {
    // Private mode: keep one for this page load so a session still coheres.
    return (cached = newId());
  }
};

// map_move fires as fast as a finger drags. Unthrottled it would spend the
// server's 60-a-minute budget in four seconds and starve every event that
// actually matters. One every two seconds is enough to see where people look.
const THROTTLE_MS = { map_move: 2000 };
const lastSent = new Map();

// True exactly once per session. The localStorage marker is what makes it
// survive a reload inside the same visit; the module flag is the fallback for
// private mode, where storage throws and once-per-page-load is the best we can
// honestly do. Either way a failure here must not drop the event, so the
// whole thing is wrapped and defaults to "not the first" on error.
const ATTR_KEY = 'pe_attr_session';
let attributed = false;
const firstOfSession = () => {
  if (attributed) return false;
  attributed = true;
  try {
    const id = sessionId();
    if (localStorage.getItem(ATTR_KEY) === id) return false;
    localStorage.setItem(ATTR_KEY, id);
    return true;
  } catch {
    // Private mode: no marker to check, so attribute this page load's first
    // event. Better a duplicate than no acquisition data at all.
    return true;
  }
};

/**
 * Record one product event. Fire-and-forget: never awaited, never throws.
 *
 * @param name  one of KNOWN
 * @param props small JSON object; the server caps it at 20 keys / 200 chars
 * @param opts  { path, town, listingId, partnerId, valuePence }
 */
export const track = (name, props = {}, opts = {}) => {
  try {
    if (!KNOWN.has(name)) {
      if (import.meta.env?.DEV) console.warn(`analytics: unknown event "${name}"`);
      return;
    }

    const gap = THROTTLE_MS[name];
    if (gap) {
      const now = Date.now();
      if (now - (lastSent.get(name) || 0) < gap) return;
      lastSent.set(name, now);
    }

    // Attribution rides the FIRST event of a session and no others — see
    // data/acquisitionSource.js for why, and for what it does and does not
    // record. Merged UNDER the caller's props so a call site always wins.
    //
    // COMPUTED AFTER THE THROTTLE, DELIBERATELY. firstOfSession() is a
    // one-shot: asking it above the throttle meant a dropped map_move could
    // consume the only chance to record where the visit came from, and the
    // attribution would be lost for that session entirely.
    const props2 = firstOfSession() ? { ...currentSource(), ...(props || {}) } : props;

    mirror(name, props2);

    if (!isSupabaseEnabled || !supabase) return;
    supabase.rpc('log_app_event', {
      p_event_name: name,
      p_session_id: sessionId(),
      p_props: props2 || {},
      p_path: opts.path ?? currentPath(),
      p_town: opts.town ?? null,
      p_listing_id: opts.listingId ?? null,
      p_partner_id: opts.partnerId ?? null,
      p_value_pence: opts.valuePence ?? null,
    }).then(() => {}, () => {});
  } catch { /* a metric never breaks a session */ }
};

/**
 * Record one event at most once per session.
 *
 * WHY THIS EXISTS. 'gem_locked_rendered' is fired from a render effect that
 * re-runs on every filter, sort and search — eighty-nine locked cards across a
 * dozen re-renders would spend the server's 60-a-minute budget and starve the
 * events that decide anything. An impression metric only has to answer "did
 * this session ever see one", so it is asked once.
 *
 * SEPARATE MARKER PER KEY, so two different once-per-session events do not
 * consume each other's chance — the attribution one-shot above was written
 * once and had exactly that bug when it sat above the throttle.
 *
 * Same storage fallback as firstOfSession(): private mode throws, so the
 * module-level Set keeps it to once per page load, which is the most that can
 * honestly be managed there.
 *
 * @param key a short stable name, so the marker survives a reload
 */
const onceFired = new Set();
export const trackOnce = (key, name, props = {}, opts = {}) => {
  try {
    if (onceFired.has(key)) return;
    onceFired.add(key);
    const marker = `pe_once_${key}`;
    try {
      const id = sessionId();
      if (localStorage.getItem(marker) === id) return;
      localStorage.setItem(marker, id);
    } catch { /* private mode: once per page load is the honest best */ }
    track(name, props, opts);
  } catch { /* a metric never breaks a session */ }
};

const currentPath = () => {
  try { return window.location.pathname || null; } catch { return null; }
};

// The overlap with funnel.js, kept in one place so neither instrument is
// wired up twice at a call site.
const mirror = (name, props) => {
  try {
    if (name === 'search') trackSearch(props?.via || 'unknown');
    else if (name === 'gem_view' || name === 'listing_view') trackSpotOpen(props?.kind);
    else if (name === 'submit_spot_done') trackSignup(props?.from || 'submit_spot');
  } catch { /* funnel.js is already defensive; this is belt and braces */ }
};

export const KNOWN_EVENTS = KNOWN;
