// How soon a space may be sold, and what the absence of this file already cost.
//
// WHAT HAPPENED. On 7 August two drivers paid for Michael Davitt GAC. On the
// 8th they arrived to locked gates, because the slots were sold with thirteen
// hours' notice on a Friday night and nobody at a volunteer-run club saw the
// email in time. Those are the only two real bookings ParkEasy has ever taken,
// so the fulfilment failure rate on genuine revenue is 100%.
//
// create-session.js checked the date against available_days, extra_dates,
// blocked_dates, available_from/until, capacity and overlaps — every question
// except "is this so soon that the host cannot possibly be ready?". It also
// never compared the start with the clock, so a slot that had already finished
// was a valid sale: booking f5e47473 was created at 14:09 on 4 August for a
// window that opened at 08:00 the same morning.
//
// WHY A SEPARATE MODULE. create-session.js cannot be imported by a test — it
// reaches for Stripe, Supabase and process.env at module scope. The rules are
// the part worth testing, so they live here with no dependencies, and the
// endpoint calls in.
//
// THE NOTICE PERIOD IS PER LISTING, DEFAULTING TO NONE. A driveway whose owner
// is at home can honour a booking made ten minutes out; a GAA club cannot.
// Defaulting to 0 means this file changes nothing for any existing listing
// until a number is set against it, so shipping it cannot take a space off
// sale by surprise.

/** Clock skew between a driver's browser and ours. Not a grace period for sales. */
export const PAST_GRACE_MS = 2 * 60000;

/** Hard ceiling on a notice period: two weeks. Beyond that something is wrong. */
export const MAX_NOTICE_HOURS = 336;

/**
 * Milliseconds of notice a listing requires. Anything absent, negative, not a
 * number or over the ceiling reads as "no requirement" rather than throwing —
 * a malformed column must not stop a sale that was previously fine.
 */
export function noticeMs(listing) {
  const h = Number(listing?.min_notice_hours);
  if (!Number.isFinite(h) || h <= 0) return 0;
  return Math.min(h, MAX_NOTICE_HOURS) * 3600000;
}

/**
 * When the slot a driver is buying actually finishes.
 *
 * Day-priced sites sell the gate window on each of `days` consecutive days, so
 * the end is the last day's closing time, not start + 24h × days.
 */
export const slotEndMs = (startMs, spanMs, days, dayPriced) =>
  startMs + spanMs + (dayPriced ? Math.max(0, days - 1) * 86400000 : 0);

/**
 * "Saturday 8 August at 7:30pm", in the host's timezone and never the server's.
 *
 * THE TIME IS NOT DECORATION. A 24-hour requirement entered at half seven on
 * Friday puts the earliest slot at half seven on SATURDAY — so a date alone
 * would tell a driver who just asked for Saturday morning that the earliest
 * they can book is Saturday. Naming the hour is the difference between a
 * refusal they can act on and one that looks like a bug.
 */
const prettyWhen = (ms, timeZone = 'Europe/London') => {
  const d = new Date(ms);
  const day = new Intl.DateTimeFormat('en-GB',
    { timeZone, weekday: 'long', day: 'numeric', month: 'long' }).format(d);
  const time = new Intl.DateTimeFormat('en-GB',
    { timeZone, hour: 'numeric', minute: '2-digit', hour12: true })
    .format(d).replace(/\s/g, '').toLowerCase();
  return `${day} at ${time}`;
};

/**
 * The three questions create-session.js never asked about the clock.
 *
 * @returns {{code:string, error:string}|null} null when the slot is sellable.
 */
export function startTimeRefusal({
  startMs, nowMs, spanMs, days = 0, dayPriced = false, listing = null,
  timeZone = 'Europe/London',
}) {
  if (!Number.isFinite(startMs) || !Number.isFinite(nowMs)) return null;

  // 1. The slot is over. True in both pricing modes and never sellable.
  if (slotEndMs(startMs, spanMs, days, dayPriced) <= nowMs) {
    return {
      code: 'slot_in_past',
      error: 'That time has already passed. Please pick a date and time in the future.',
    };
  }

  // 2. An hourly slot that started before now. Charging for an hour already
  //    gone is not the same mistake as 1 — the hour may still be running — but
  //    it is still selling time the driver cannot use. A day-priced site is
  //    deliberately exempt: arriving at 2pm into a 9am–8.30pm window is the
  //    normal way a matchday car park is used.
  if (!dayPriced && startMs < nowMs - PAST_GRACE_MS) {
    return {
      code: 'start_in_past',
      error: 'That start time has already passed. Please pick a later time.',
    };
  }

  // 3. Too little notice for this host to be ready. Checked last, because
  //    "that date is gone" is a clearer thing to be told than "we need a day".
  const need = noticeMs(listing);
  if (need > 0 && startMs - nowMs < need) {
    const hours = Math.round(need / 3600000);
    const earliest = prettyWhen(nowMs + need, timeZone);
    return {
      code: 'too_soon',
      error: `This car park needs ${hours} hours' notice so the gates are open when you arrive. `
        + `The earliest you can book is ${earliest}.`,
    };
  }

  return null;
}

/**
 * The earliest London calendar day on which a notice period allows anything.
 *
 * A FLOOR, NOT THE ANSWER. A 24-hour requirement at 18:00 on the 8th makes the
 * 9th bookable from 18:00 onwards, not from midnight: the hours inside that day
 * are startTimeRefusal()'s business. This exists so a date picker cannot offer
 * a day on which nothing whatsoever could be sold — which is what it did
 * before, opening the sheet on today's date against a 24-hour requirement and
 * contradicting itself on the next line.
 *
 * Returns null where there is no requirement, so a caller can skip it entirely
 * rather than comparing against today.
 *
 * THE ZONE IS PINNED. Computed with the server's own clock, "tomorrow" flips at
 * midnight UTC, which is 1am Belfast for most of the year — so for that hour
 * every notice period would be a day out.
 *
 * @param {object|null} listing   read for min_notice_hours
 * @param {number} nowMs          injected so this is testable without the clock
 * @returns {string|null} yyyy-mm-dd
 */
export function noticeFloorDay(listing, nowMs = Date.now(), timeZone = 'Europe/London') {
  const need = noticeMs(listing);
  if (need <= 0) return null;
  // en-CA formats as yyyy-mm-dd, which is the shape every date column and the
  // <input type="date"> value both use.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(nowMs + need));
}
