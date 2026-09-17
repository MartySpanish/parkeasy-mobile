// What Premium actually is, in one place, with the proof attached.
//
// WHAT WAS BEING SOLD. The pricing sheet listed six benefits as a hardcoded
// array of emoji and strings. Two of them were not true:
//
//   "🗺️ Offline maps — works without signal"
//       There were no offline maps. public/sw.js said, in as many words,
//       `if (!isAppShell) return; // OSM tiles, fonts, etc. pass through
//       normally` — so with no signal the map drew nothing at all. Somebody
//       paid £29 a year partly for this.
//
//   "🔔 Notifications when spots free up"
//       This one exists — api/cron/notify-waitlist.js — and is free to
//       everybody who leaves an email. Charging for it is a different kind of
//       untruth from inventing it, and not much better.
//
// THE FIX IS STRUCTURAL, not a wording change. Every claim below carries a
// `proof`: the identifier in this repository that implements it.
// tests/unit/premium.test.mjs greps for each one and fails if it is missing, so
// a benefit cannot be listed here without something in the codebase to back it,
// and a feature cannot be deleted while the paywall still sells it.
//
// `tier` says who gets it. 'premium' means the free tier does not, which the
// test also checks. 'everyone' entries stay on the sheet — they are reasons to
// use ParkEasy and they are honest about being free — under their own heading.

export const PREMIUM_BENEFITS = [
  {
    icon: '✨',
    text: 'Hidden gems — founder-curated free spots in ideal locations',
    tier: 'premium',
    // The gate itself, plus the RLS policy behind it.
    proof: { file: 'src/App.jsx', needle: 'const isGated = (spot) =>' },
  },
  {
    icon: '⚡',
    text: 'Premium EV charger spots',
    tier: 'premium',
    proof: { file: 'src/App.jsx', needle: 'return spot.premium === true;' },
  },
  {
    icon: '📍',
    text: 'Sort by distance — nearest spots first',
    tier: 'premium',
    proof: { file: 'src/App.jsx', needle: "{ id:'distance', label:'📍 Nearest' }" },
  },
  {
    icon: '🗺️',
    // NOT "works without signal", which would be a promise about a place the
    // driver has never opened. It caches the tiles they have actually looked
    // at, which is the useful case — you drive back to the car park you were
    // looking at this morning, in a basement, with no bars.
    text: 'Offline maps — the areas you’ve looked at keep working with no signal',
    tier: 'premium',
    proof: { file: 'public/sw.js', needle: 'TILE_CACHE' },
  },
  {
    icon: '💎',
    text: 'Premium badge on your profile',
    tier: 'premium',
    proof: { file: 'src/App.jsx', needle: 'isPremium && <Star size={16}' },
  },
  {
    icon: '🔔',
    // Moved out of the Premium list rather than deleted. It is real and it is
    // free, and saying so is worth more than pretending it is a perk.
    text: 'Told when a space opens near where you looked — free for everyone',
    tier: 'everyone',
    proof: { file: 'api/cron/notify-waitlist.js', needle: 'RADIUS_M' },
  },
];

/** The claims Premium is actually charged for. */
export const paidBenefits = () => PREMIUM_BENEFITS.filter(b => b.tier === 'premium');
/** The ones that are true for everybody, shown under their own heading. */
export const freeBenefits = () => PREMIUM_BENEFITS.filter(b => b.tier === 'everyone');
