// Single source of truth for ParkEasy's money rules. Imported by
// /api/checkout/create-session and /api/passes so the two can never drift.
// The client mirrors these in src/App.jsx (search PRICING MIRROR) — change
// both together, and the walkthrough in TEST_MODE_WALKTHROUGH.md with them.
//
// The leading underscore keeps Vercel from routing this file as an endpoint.
//
// Decision, 28 July 2026 — take more from the driver, never from the host:
//   * Host commission stays at 15%. It is in signed host agreements, in the
//     press and on the flyers, and host supply is the binding constraint.
//     Raising it would be the one change that damages the business.
//   * The driver fee moves from a flat £1 to 15% of the booking, floored and
//     capped. Flat was regressive against us on small bookings and left money
//     on the table on event-day ones. Even after this, the total take (~26%)
//     sits below JustPark's ~30%.
//   * A floor keeps tiny bookings above the fixed card fee (1.5% + 20p);
//     a cap stops a month-long booking carrying an absurd fee.

export const HOST_COMMISSION = 0.15;      // host keeps 85% — do not raise

export const DRIVER_FEE_RATE = 0.15;      // driver fee as a share of the booking
export const DRIVER_FEE_EVENT_RATE = 0.20;// event days — matches how every parking operator prices
export const DRIVER_FEE_MIN_PENCE = 99;   // floor: below this the card fee eats it
// Cap. Raised 350 -> 500 on 28 Jul 2026, tuned for "reasonable but as
// profitable as possible": at 350 the take rate FELL to 18-22% on long and
// event bookings, which is where we were leaving the most money. At 500 those
// land around 20-26%, still comfortably under JustPark's ~30%. The cap only
// binds above a £33.33 space price, so every ordinary hourly booking is
// completely unaffected.
export const DRIVER_FEE_MAX_PENCE = 500;

// Minimum a driver can be charged for parking, before the service fee. Below
// this the fixed part of the card fee makes the transaction not worth running.
export const MIN_BOOKING_PENCE = 400;     // £4.00

// ── Partner experiences (tours) ──────────────────────────────────────────────
// A different deal from parking and priced as such: 10% of the tour, no driver
// service fee on top. The operator sets the price, the driver pays exactly
// that, and our cut comes out of the operator's side — which is what makes it
// an easy yes for someone already selling at a fixed rate.
//
// The rate lives per row on experiences.commission_rate; this is only the
// default for a new one.
export const EXPERIENCE_COMMISSION = 0.10;

/**
 * Split for an experience booking, in pence.
 *   driver pays      = the tier price, nothing added
 *   ParkEasy takes   = commission_rate of it
 *   operator gets    = the rest, paid straight to their Connect account
 */
export function experienceBreakdown(pricePence, commissionRate = EXPERIENCE_COMMISSION) {
  const total = Math.max(0, Math.round(Number(pricePence) || 0));
  const rate = Math.min(0.30, Math.max(0, Number(commissionRate) || 0));
  const commission = Math.round(total * rate);
  return {
    totalPence: total,                        // what the driver is charged
    commissionPence: commission,              // ParkEasy (Stripe application fee)
    operatorReceivesPence: total - commission,
  };
}

/**
 * Driver service fee for a booking, in whole pence.
 * Percentage of the booking price, clamped to [floor, cap].
 * DRIVER_SERVICE_FEE_PENCE (env) still forces a flat fee if set, so the old
 * behaviour remains available as an escape hatch without a redeploy.
 */
export function driverServiceFeePence(bookingPricePence, env = {}, opts = {}) {
  const override = parseInt(env.DRIVER_SERVICE_FEE_PENCE ?? '', 10);
  if (Number.isFinite(override) && override >= 0) return override;

  const base = Math.max(0, Math.round(Number(bookingPricePence) || 0));
  if (base === 0) return 0;   // nothing booked, nothing to charge a fee on
  const rate = opts.eventDay ? DRIVER_FEE_EVENT_RATE : DRIVER_FEE_RATE;
  const pct = Math.round(base * rate);
  return Math.min(DRIVER_FEE_MAX_PENCE, Math.max(DRIVER_FEE_MIN_PENCE, pct));
}

/**
 * Full breakdown for a booking price, in pence. Single place that decides who
 * gets what, so the checkout line items, the booking row and the host's
 * earnings view can never disagree.
 *
 *   driver pays     = booking + serviceFee
 *   ParkEasy takes  = 15% of booking + the whole service fee
 *   host receives   = booking - 15% of booking  (i.e. 85%)
 */
/**
 * opts.eventDay      — true when the date carries a host price override, which
 *                      is what an event day IS in this product. Raises the
 *                      driver fee to 20%; the host's 85% is untouched.
 * opts.surchargePence— a fee the HOST receives IN FULL, e.g. Belfast Royal
 *                      Academy's £10 for a car left in after the gates are
 *                      locked. Deliberately outside the commission base: we
 *                      collect it and pass every penny on, exactly as signed.
 *                      Taking 15% of it would breach the agreement.
 */
export function priceBreakdown(bookingPricePence, env = {}, opts = {}) {
  const booking = Math.max(0, Math.round(Number(bookingPricePence) || 0));
  const surcharge = Math.max(0, Math.round(Number(opts.surchargePence) || 0));
  const serviceFee = driverServiceFeePence(booking, env, opts);
  const commission = Math.round(booking * HOST_COMMISSION);
  return {
    bookingPence: booking,
    surchargePence: surcharge,
    serviceFeePence: serviceFee,
    commissionPence: commission,
    eventDay: !!opts.eventDay,
    // What ParkEasy keeps. The surcharge is absent on purpose — it is the
    // host's money in full.
    applicationFeePence: commission + serviceFee,
    // 85% of the space price, PLUS the whole surcharge.
    hostReceivesPence: (booking - commission) + surcharge,
    totalPence: booking + serviceFee + surcharge,
  };
}
