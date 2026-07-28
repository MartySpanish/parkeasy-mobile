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
export const DRIVER_FEE_MIN_PENCE = 99;   // floor: below this the card fee eats it
export const DRIVER_FEE_MAX_PENCE = 350;  // cap: a £40 monthly booking is not £6 of fee

// Minimum a driver can be charged for parking, before the service fee. Below
// this the fixed part of the card fee makes the transaction not worth running.
export const MIN_BOOKING_PENCE = 400;     // £4.00

/**
 * Driver service fee for a booking, in whole pence.
 * Percentage of the booking price, clamped to [floor, cap].
 * DRIVER_SERVICE_FEE_PENCE (env) still forces a flat fee if set, so the old
 * behaviour remains available as an escape hatch without a redeploy.
 */
export function driverServiceFeePence(bookingPricePence, env = {}) {
  const override = parseInt(env.DRIVER_SERVICE_FEE_PENCE ?? '', 10);
  if (Number.isFinite(override) && override >= 0) return override;

  const base = Math.max(0, Math.round(Number(bookingPricePence) || 0));
  if (base === 0) return 0;   // nothing booked, nothing to charge a fee on
  const pct = Math.round(base * DRIVER_FEE_RATE);
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
export function priceBreakdown(bookingPricePence, env = {}) {
  const booking = Math.max(0, Math.round(Number(bookingPricePence) || 0));
  const serviceFee = driverServiceFeePence(booking, env);
  const commission = Math.round(booking * HOST_COMMISSION);
  return {
    bookingPence: booking,
    serviceFeePence: serviceFee,
    commissionPence: commission,
    applicationFeePence: commission + serviceFee,   // what ParkEasy keeps
    hostReceivesPence: booking - commission,        // 85%
    totalPence: booking + serviceFee,               // what the driver pays
  };
}
