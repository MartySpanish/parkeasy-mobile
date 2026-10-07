// Discount codes for the Premium subscription — what they are, and why they
// cannot live in promo_codes.
//
// TWO DIFFERENT THINGS SHARE THE WORD "PROMO" IN THIS CODEBASE:
//
//   promo_codes / api/redeem-promo.js  →  grants FREE DAYS of Premium.
//                                         PARKEZ, PARKEZ6M. No money moves.
//   a Stripe coupon + promotion code   →  takes a PERCENTAGE OFF a charge.
//
// A 20%-off code is the second kind and can only be the second kind, because
// Stripe is where the money is taken. promo_codes has a `days` column and no
// concept of an amount: putting SPOTS20 in there would hand somebody free days
// instead of a discount, which is a different product wearing the same name.
//
// So the discount is a Stripe promotion code, and promo_redemptions stays what
// it already is — the ledger of who used what. One system for charging, one
// for recording, which is how it already works for STRIPE-SUB.
//
// WHY THIS FILE EXISTS AT ALL. Premium is sold through hardcoded Stripe PAYMENT
// LINKS (src/App.jsx), not a Checkout Session we create, so the discount is
// entered on Stripe's own checkout page and Stripe shows its own errors. The
// one thing we control is what happens when somebody types a checkout-only
// code into the in-app promo box, which they will, because it is the box
// labelled "promo code". Without this they get "That promo code isn't valid"
// for a code that is perfectly valid in the place it belongs.
//
// Pure and dependency-free so Node can drive it.

/**
 * Codes that are redeemed at Stripe checkout, not in the app's promo box.
 *
 * `plan` is the only plan the code applies to. `priceLookupKey` is the Stripe
 * price lookup key rather than a price id: ids differ between test and live
 * mode, and hardcoding one would make this file wrong in whichever mode it was
 * not written for.
 */
export const CHECKOUT_PROMOS = [
  {
    code: 'SPOTS20',
    percentOff: 20,
    plan: 'annual',
    priceLookupKey: 'premium_annual_v2',
    // 31 October 2026, end of day, Europe/London.
    //
    // BST ENDS ON 25 OCTOBER 2026, so 31 October is GMT and London is UTC+0 —
    // which is the only reason this literal is correct as written. Six days
    // earlier it would have been an hour out. Any future expiry in this file
    // needs the same check rather than an assumption.
    expiresAt: '2026-10-31T23:59:59Z',
    maxRedemptions: 200,
    firstTimeOnly: true,
    duration: 'once',
  },
];

const find = (entered) => {
  const c = String(entered || '').trim().toUpperCase();
  return CHECKOUT_PROMOS.find(p => p.code === c) || null;
};

/** Is this a code that belongs at Stripe checkout rather than the promo box? */
export const checkoutPromo = (entered) => find(entered);

/** Has it expired? Separate from "is it a checkout code", so the message can differ. */
export const checkoutPromoExpired = (entered, now = Date.now()) => {
  const p = find(entered);
  if (!p) return false;
  const end = Date.parse(p.expiresAt);
  return Number.isFinite(end) && now > end;
};

/**
 * What to tell somebody who typed a checkout-only code into the app.
 *
 * Says where it works and what it does, because "invalid" would be a lie: the
 * code is real and they are holding it for the right reason.
 */
export const checkoutPromoMessage = (entered, now = Date.now()) => {
  const p = find(entered);
  if (!p) return null;
  if (checkoutPromoExpired(entered, now)) {
    return `${p.code} expired on 31 October 2026 and can no longer be used.`;
  }
  const plan = p.plan === 'annual' ? 'yearly' : p.plan;
  return `${p.code} is ${p.percentOff}% off the ${plan} subscription — enter it on the payment page when you subscribe, not here. This box is for codes that add free Premium days.`;
};

/**
 * The discounted amount, in integer pence. No floats anywhere near money.
 *
 * Returns null for a plan the code does not cover, which is what makes
 * "rejected on the monthly plan" a calculation rather than a message.
 */
export const discountedPence = (entered, plan, listPence) => {
  const p = find(entered);
  if (!p || p.plan !== plan) return null;
  if (!Number.isInteger(listPence) || listPence <= 0) return null;
  const off = Math.round((listPence * p.percentOff) / 100);
  return { listPence, discountPence: off, payPence: listPence - off };
};
