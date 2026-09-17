// What each partner tier actually buys.
//
// The columns for this have been on `partners` for months with nothing setting
// them, so every partner has had the same card for nothing. These are the rules
// the app enforces; the price is what Marty sells against them.
//
//   listed     free    name and pin only, NO card
//   featured   £25/mo  card with logo, tagline, photo and link
//   sponsored  £60/mo  featured, plus sorts first inside radius_m, plus the
//                      booking-confirmation slot local_offers was built for
//
// Kept in one module because three places need to agree about it — the card
// query, the sort, and the admin screen that sells it — and a tier that renders
// in one place and not another is a partner ringing up about a card they
// cannot see.
export const TIERS = {
  listed:    { label: 'Listed',    pricePence: 0,    card: false, confirmationSlot: false, boost: 0 },
  featured:  { label: 'Featured',  pricePence: 2500, card: true,  confirmationSlot: false, boost: 0 },
  sponsored: { label: 'Sponsored', pricePence: 6000, card: true,  confirmationSlot: true,  boost: 1000 },
};

/** The tiers that get a card rendered. The query filters on this too. */
export const CARD_TIERS = Object.keys(TIERS).filter(t => TIERS[t].card);

/**
 * An unknown or missing tier renders NOTHING.
 *
 * Deliberately the strict direction. The opposite default — treat unknown as
 * featured — means a typo, or a tier added to the database before the app knows
 * about it, silently hands out a paid placement for free. The live partners
 * were grandfathered to 'featured' as real rows in
 * 20260907_partner_tiers.sql precisely so this function never has to guess.
 */
export const rendersCard = (tier) => TIERS[tier]?.card === true;

export const hasConfirmationSlot = (tier) => TIERS[tier]?.confirmationSlot === true;

/**
 * Sort weight within a listing's radius. Sponsored outranks featured; below
 * that the hand-set `priority` decides, and distance breaks the tie.
 *
 * The boost is added to priority rather than replacing it, so the ordering
 * Marty has already tuned by hand still holds inside each tier.
 */
export const sortWeight = (partner) =>
  (TIERS[partner?.tier]?.boost || 0) + (Number(partner?.priority) || 0);

export const priceLabel = (tier) => {
  const p = TIERS[tier];
  if (!p) return '—';
  return p.pricePence === 0 ? 'Free' : `£${(p.pricePence / 100).toFixed(0)}/mo`;
};
