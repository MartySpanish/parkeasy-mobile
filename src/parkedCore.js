// The arithmetic of finding a car, with nothing else attached.
//
// A separate module for one reason: src/parked.js imports ./supabase and
// ./analytics, which only Vite can resolve, so nothing in it can be imported by
// a plain Node test. The same split already exists for push (src/pushCore.js).
// Everything here is pure — no storage, no network, no import.meta.env — so
// tests/unit/parkingTimer.test.mjs can drive the real functions rather than
// asserting on the text of them.

/** Metres between two points. Haversine — good to a few metres at city scale. */
export const metresBetween = (aLat, aLng, bLat, bLng) => {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
};

/**
 * "120 m" / "1.4 km" — how far the car is.
 *
 * Rounded to the nearest 10m under a kilometre. A phone's own position is good
 * to maybe 10m on a street with buildings either side, so "137 m" claims a
 * precision the number does not have. Floored at 10 m rather than rounding to
 * "0 m", which reads as "you are standing on it" when the driver plainly is not.
 */
export const walkLabel = (m) => {
  if (!Number.isFinite(m)) return '';
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
  return `${(m / 1000).toFixed(1)} km`;
};

/** Roughly how long that walk takes, at 80 metres a minute. Never "0 min". */
export const walkMinutes = (m) => (Number.isFinite(m) ? Math.max(1, Math.round(m / 80)) : null);

/**
 * A maps link back to the car.
 *
 * Coordinates, never the spot's name: the name is what the host called it, and
 * "Rear yard" is not an address a maps app can find. Walking mode, because the
 * driver is on foot by definition — they left the car at the other end.
 *
 * null when the record has no position, which is every session recorded before
 * this shipped. A "find my car" button that cannot find the car is worse than
 * no button, so the caller is expected to render nothing on null.
 */
export const directionsToCar = (parked) => {
  if (!parked || !Number.isFinite(parked.lat) || !Number.isFinite(parked.lng)) return null;
  return `https://www.google.com/maps/dir/?api=1&destination=${parked.lat},${parked.lng}&travelmode=walking`;
};

/** Milliseconds left on the timer, or null when none is set. */
export const timeLeft = (parked, now = Date.now()) =>
  parked?.dueAt ? parked.dueAt - now : null;

// The bounds set_parking_timer() enforces, restated so the UI can explain
// itself without a round trip — not INSTEAD of there, because a client-side
// bound is a suggestion. MIN is tied to the sweep interval: a reminder that is
// due in less time than the sweep takes to come round cannot be kept.
export const MIN_TIMER_MINS = 10;
export const MAX_TIMER_MINS = 24 * 60;

/** Which way a requested timer is out of bounds, or null when it is fine. */
export const timerBoundReason = (minutes) => {
  const mins = Math.round(Number(minutes) || 0);
  if (mins < MIN_TIMER_MINS) return 'too-short';
  if (mins > MAX_TIMER_MINS) return 'too-long';
  return null;
};
