// The words this feature is allowed to use.
//
// A permit here is a RIGHT OF ENTRY AGAINST A QUOTA. It is not a numbered bay,
// and ParkEasy does not control these car parks — the operator does, and their
// own season-ticket terms say a ticket "does not guarantee you a space". What
// ParkEasy can promise is the thing it controls: that it will never issue more
// permits for a date than the block holds.
//
// So the vocabulary is fixed, and it is fixed HERE rather than scattered through
// JSX, so that changing it is a deliberate act and grepping for the banned words
// finds one file. `assertNoBayLanguage` is called by the screens in development;
// it throws rather than warns, because a warning in a console nobody is reading
// is not a guardrail.
export const BANNED = [
  'reserved bay', 'your bay', 'bay number', 'reserved space', 'your space is reserved',
];

export const COPY = {
  // What a member has.
  access: (carPark) => `You have access to ${carPark}`,
  accessOn: (carPark, when) => `You have access to ${carPark} on ${when}`,
  // What the product is.
  permitOne: 'permit',
  permitMany: 'permits',
  guarantee: 'Guaranteed access',
  // The honest limit, said once on the member screen and once in the email.
  // Not small print: it is the difference between what ParkEasy promises and
  // what it cannot.
  disclaimer:
    'A permit is guaranteed entry against your company’s allocation — ParkEasy never issues '
    + 'more permits for a day than the allocation holds. It is not a numbered bay, and spaces '
    + 'inside the car park are first come, first served.',
  fullyBooked: 'Fully booked for that date.',
};

/** Throws if any user-facing string in this feature has drifted back to bays. */
export function assertNoBayLanguage(strings) {
  for (const s of strings) {
    const low = String(s || '').toLowerCase();
    for (const bad of BANNED) {
      if (low.includes(bad)) {
        throw new Error(
          `ParkEasy for Business must not say "${bad}" — a permit is a right of entry `
          + `against a quota, not a bay ParkEasy can reserve. Found in: ${s}`,
        );
      }
    }
  }
}
