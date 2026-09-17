// What a points balance is allowed to say.
//
// Pure, and split from points.js for the usual reason: that file imports
// ../supabase, which only Vite resolves.
//
// THE RULE THIS FILE EXISTS FOR. A points balance is the easiest place in an
// app to make a promise you cannot keep. "You're 40 points away!" is a
// promise; "1,240 points" with nothing to spend them on is a made-up currency.
// So every sentence here is derived from two real numbers — the balance, and
// the price of the one reward that exists — and the reward is Premium days,
// which already has a price in pounds.

/** The tariff, for the "how to earn" list. Mirrors point_value() in the migration. */
export const EARN_WAYS = [
  { kind: 'spot_approved',   points: 25, label: 'A spot we put on the map',      note: 'Paid when it passes review' },
  { kind: 'report_accurate', points: 15, label: 'A report that turns out right', note: 'Paid when we check it' },
  { kind: 'photo_approved',  points: 10, label: 'A photo we publish',            note: 'Paid when it passes review' },
  { kind: 'signal',          points: 1,  label: 'Still here / Changed',          note: 'Up to 5 a day' },
];

/**
 * The line under the balance.
 *
 * @param p the my_points() payload, or null/undefined before it loads
 * @returns { balance, cost, days, ready, text, progress }
 *
 * `progress` is 0..1 for the bar. It is capped at 1: a driver with 300 points
 * is not 300% of the way to a 30-day reward, they have three of them waiting.
 */
export const pointsSummary = (p) => {
  const balance = Math.max(0, Number(p?.balance) || 0);
  const cost = Math.max(1, Number(p?.cost) || 100);
  const days = Math.max(1, Number(p?.days) || 30);
  const ready = Boolean(p?.can_redeem) && balance >= cost;
  const short = Math.max(0, cost - balance);

  return {
    balance, cost, days, ready,
    progress: Math.min(1, balance / cost),
    // NEVER "you're almost there". How far off they are is a fact; whether it
    // is close is an opinion, and dressing 80 points as almost-there is how a
    // rewards screen starts lying in small ways.
    text: ready
      ? `Enough for ${days} days of Premium`
      : balance === 0
        ? `${cost} points is ${days} days of Premium`
        : `${short} more ${short === 1 ? 'point' : 'points'} for ${days} days of Premium`,
  };
};

/**
 * How a ledger row reads on the driver's own history.
 *
 * Unknown kinds are described rather than hidden: a row the client does not
 * recognise is a row a later deploy added, and showing "+25" with no label is
 * better than a balance that does not add up on screen.
 */
export const LEDGER_LABELS = {
  spot_approved:   'Spot added to the map',
  photo_approved:  'Photo published',
  report_accurate: 'Report checked and right',
  signal:          'Confirmed a spot',
  redeemed:        'Redeemed for Premium',
};

export const ledgerLabel = (kind) => LEDGER_LABELS[kind] || 'Contribution';
