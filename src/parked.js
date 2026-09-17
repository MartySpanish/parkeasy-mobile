// Where the car is, and when it has to move.
//
// THREE THINGS A DRIVER ACTUALLY NEEDS once they have walked away, and none of
// them worked before this file:
//
//   1. A reminder that arrives. The countdown lived in a React state and a
//      localStorage key, so it was accurate only while the tab was alive —
//      which is never the case by the time it matters. The timer is now written
//      to the database and pushed by a cron sweep (api/cron/parking-timers.js).
//   2. A way back. The session recorded the spot's NAME and nothing else, so
//      the app knew the driver was parked at "Dublin Road on-street" and could
//      not point at it. Coordinates are captured at the moment of parking.
//   3. Something to send someone. "I'm at the car park, meet me at the car" is
//      a location, not a sentence.
//
// The record lives in localStorage on purpose: parking is not an account
// feature. A guest parks, gets reminded and finds their car again without ever
// signing in, and the session id — the same one push_subscriptions is keyed on
// — is what ties the reminder to this browser.

import { supabase, isSupabaseEnabled } from './supabase';
import { sessionId } from './analytics';
import { directionsToCar, timerBoundReason } from './parkedCore';

// The pure arithmetic lives in ./parkedCore so a plain Node test can import it
// — this module's ./supabase import is resolvable only by Vite. Re-exported
// here so callers have one place to import "parking" from.
export {
  metresBetween, walkLabel, walkMinutes, directionsToCar, timeLeft,
  MIN_TIMER_MINS, MAX_TIMER_MINS,
} from './parkedCore';

const KEY = 'pe_session';

const read = () => {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
};
const write = (v) => {
  try { v ? localStorage.setItem(KEY, JSON.stringify(v)) : localStorage.removeItem(KEY); } catch { /* private mode */ }
  return v;
};

/** The current parked record, or null. */
export const getParked = () => read();

/**
 * Record that the driver has parked here.
 *
 * Coordinates come from the SPOT, not from the phone's own position: the phone
 * may be a hundred metres away by the time the button is tapped, and the spot's
 * position is the one thing here that is surveyed rather than sensed.
 */
export const startParked = ({ spotId, name, rate = 0, lat, lng }) => write({
  spotId, name, rate: rate || 0,
  lat: Number.isFinite(lat) ? lat : null,
  lng: Number.isFinite(lng) ? lng : null,
  startedAt: Date.now(),
  // Set later by setTimer(); kept on the record so the countdown survives a
  // reload and matches what the server will send.
  dueAt: null,
  warnMins: null,
});

/** Forget the car, and cancel any reminder that was owed. */
export const endParked = async () => {
  const had = read();
  write(null);
  if (had?.dueAt) await cancelTimer();
  return had;
};

/**
 * Set the reminder.
 *
 * @param minutes how long the parking lasts from now
 * @param warnMins how long before the end to be warned
 * @returns { ok, reason } — 'too-short' and 'too-long' mirror the bounds the
 *   database enforces, so the UI can say which it was rather than "failed".
 */
export const setTimer = async (minutes, warnMins = 15) => {
  const parked = read();
  if (!parked) return { ok: false, reason: 'not-parked' };
  const mins = Math.round(Number(minutes) || 0);
  // The same bounds as set_parking_timer(), from the one place that states
  // them, so the UI can explain itself without a round trip.
  const bad = timerBoundReason(mins);
  if (bad) return { ok: false, reason: bad };

  const dueAt = Date.now() + mins * 60000;
  const next = write({ ...parked, dueAt, warnMins });

  if (!isSupabaseEnabled || !supabase) {
    // No database: the countdown still shows, but say so rather than implying
    // a notification is coming.
    return { ok: true, reason: 'local-only', parked: next };
  }
  try {
    const { data, error } = await supabase.rpc('set_parking_timer', {
      p_session_id: sessionId(),
      p_due_at: new Date(dueAt).toISOString(),
      p_warn_mins: warnMins,
      p_label: parked.name || null,
      p_lat: parked.lat,
      p_lng: parked.lng,
    });
    if (error || data !== true) return { ok: true, reason: 'local-only', parked: next };
    return { ok: true, reason: 'scheduled', parked: next };
  } catch {
    return { ok: true, reason: 'local-only', parked: next };
  }
};

/** Turn the reminder off but stay parked. */
export const cancelTimer = async () => {
  const parked = read();
  if (parked) write({ ...parked, dueAt: null, warnMins: null });
  if (!isSupabaseEnabled || !supabase) return false;
  try {
    const { data } = await supabase.rpc('cancel_parking_timer', { p_session_id: sessionId() });
    return data === true;
  } catch { return false; }
};

/**
 * Share where the car is.
 *
 * A maps link and a plain sentence, because the person receiving it may be
 * reading it in a message app that shows neither a map nor a preview. Returns
 * how it went so the caller can say "copied" rather than nothing at all.
 */
export const shareParked = async (parked) => {
  const url = directionsToCar(parked);
  if (!url) return { ok: false, reason: 'no-position' };
  const text = parked.name ? `The car is at ${parked.name}` : 'This is where the car is';
  try {
    if (typeof navigator !== 'undefined' && navigator.share) {
      await navigator.share({ title: 'Where the car is', text, url });
      return { ok: true, how: 'shared' };
    }
    await navigator.clipboard.writeText(`${text} — ${url}`);
    return { ok: true, how: 'copied' };
  } catch {
    // A cancelled share sheet lands here too, which is not a failure worth
    // reporting to the driver.
    return { ok: false, reason: 'cancelled' };
  }
};
