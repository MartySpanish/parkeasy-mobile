// What a referral is allowed to claim, and how a code is read.
//
// Pure, and split from referrals.js because that file imports ../supabase,
// which only Vite resolves.

// The alphabet the migration's CHECK constraint uses: no I, L, O, S, 0, 1 or 5,
// because the code gets read out in a car park and typed on a phone. Kept in
// step with referral_codes_shape — a mismatch here means the app refuses a code
// the database would have accepted, or accepts one it will reject.
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRTUVWXYZ2346789';
export const CODE_RE = new RegExp(`^[${CODE_ALPHABET}]{6}$`);

/**
 * A typed or pasted code, as the database wants it — or null.
 *
 * Upper-cased and trimmed because that is what a person actually types. The
 * common confusions are mapped rather than rejected: somebody reading "PQ4R7T"
 * off a phone screen and typing a lower-case l for a 1 has not made a mistake
 * worth losing a referral over, and none of the letters they might have meant
 * are in the alphabet.
 */
export const normaliseCode = (raw) => {
  const up = String(raw ?? '').trim().toUpperCase()
    .replace(/[IL]/g, '1').replace(/O/g, '0').replace(/S/g, '5')
    // …and then the digits they cannot be, since 0, 1 and 5 are not in the
    // alphabet either. This is deliberately a dead end for a genuinely wrong
    // character: it becomes an invalid code and is reported as one.
    .replace(/[015]/g, '?');
  return CODE_RE.test(up) ? up : null;
};

/** Is this what a referral code looks like at all? */
export const looksLikeCode = (raw) => normaliseCode(raw) !== null;

/**
 * The line on the referral card.
 *
 * BOTH NUMBERS, ALWAYS. "4 joined, 2 counted" is the honest story; showing only
 * the first implies points that are not coming, and the gap is exactly the
 * thing the referrer needs to understand — a referral pays when the person they
 * brought contributes something we keep, not when they sign up.
 */
export const referralLine = (r) => {
  const joined = Math.max(0, Number(r?.joined) || 0);
  const qualified = Math.min(joined, Math.max(0, Number(r?.qualified) || 0));
  const each = Math.max(0, Number(r?.points_each) || 0);

  if (joined === 0) {
    return { joined, qualified, each,
      text: `${each} points when someone you invite adds a spot we keep` };
  }
  if (qualified === joined) {
    return { joined, qualified, each,
      text: joined === 1
        ? 'One driver joined and counted — thanks'
        : `${joined} drivers joined, all ${joined} counted — thanks` };
  }
  return { joined, qualified, each,
    // Never "2 pending points!". They are not pending; they arrive if and when
    // that person contributes something, and they may never arrive at all.
    text: `${joined} joined, ${qualified} counted so far — a referral counts `
        + 'once they add something we keep' };
};

/**
 * What to tell somebody whose claim did not take.
 *
 * Every branch names what happened. A code that silently does nothing is the
 * worst outcome here: the driver believes their friend got the credit and the
 * friend never did.
 */
export const claimMessage = (reason) => ({
  recorded:         'Code applied — your mate gets credit when you add your first spot',
  own_code:         'That’s your own code',
  already_referred: 'You’ve already used a code',
  not_new:          'Codes are for new drivers — you were already on the map',
  unknown_code:     'We don’t recognise that code',
  bad_code:         'That doesn’t look like a referral code',
  signed_out:       'Sign in first and the code will apply',
}[reason] || 'Couldn’t apply that code just now');
