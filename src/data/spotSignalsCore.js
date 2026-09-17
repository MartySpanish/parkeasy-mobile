// What the detail sheet says about a spot, given what drivers have said.
//
// Pure, and separate from spotSignals.js for the usual reason: that file
// imports ../supabase, which only Vite can resolve, so nothing in it can be
// imported by a plain Node test. Same split as src/pushCore.js and
// src/parkedCore.js.
//
// THE SENTENCE THIS REPLACES was "Confirmed by 0 drivers", under a green tick,
// on all 744 spots — because `votes` is a field in the seed data and every one
// of them is 0, and the only thing that could raise it was the reader's own
// localStorage. A count of one that nobody else can see is not a count.

/** The signals a driver can give. Kept in step with the migration's CHECK. */
export const SIGNALS = ['confirmed', 'changed'];

/**
 * How a spot's community signals read.
 *
 * @param counts  the spot_signal_counts row for this spot, or undefined
 * @param mine    'confirmed' | 'changed' | null — what THIS driver said
 * @returns { confirmed, changed, tone, text, mine }
 *
 * `tone` is what the UI colours on: 'quiet' (nobody has said anything),
 * 'confirmed', or 'disputed'. Never 'wrong' — see below.
 */
export const signalSummary = (counts, mine = null) => {
  const confirmed = Math.max(0, Number(counts?.confirmed_30d ?? counts?.confirmed ?? 0) || 0);
  const changed   = Math.max(0, Number(counts?.changed_30d   ?? counts?.changed   ?? 0) || 0);
  const who = SIGNALS.includes(mine) ? mine : null;

  // NOTHING SAID IS SAID AS NOTHING. "Confirmed by 0 drivers" beside a tick
  // reads as a verdict, and it was the verdict on every spot in the app. The
  // absence of answers is not evidence about the spot, it is the absence of
  // evidence, and the line's job here is to ask rather than to report.
  if (confirmed === 0 && changed === 0) {
    // A driver's own answer is always acknowledged, even when the count has
    // not caught up — no database behind the build, or the request did not
    // land. Without this branch the sheet read "Nobody has confirmed this one
    // recently" directly beside "you confirmed just now", which is the kind of
    // contradiction that makes a person distrust everything else on the page.
    if (who === 'changed') {
      return { confirmed, changed, mine: who, tone: 'disputed',
        text: 'You said this one has changed — thanks, it is queued for a check.' };
    }
    if (who === 'confirmed') {
      return { confirmed, changed, mine: who, tone: 'confirmed',
        text: 'You said this one is still here — thanks.' };
    }
    return { confirmed, changed, mine: who, tone: 'quiet',
      text: 'Nobody has confirmed this one recently. Been here?' };
  }

  const drivers = (n) => `${n} driver${n === 1 ? '' : 's'}`;

  if (changed === 0) {
    return {
      confirmed, changed, mine: who, tone: 'confirmed',
      text: `${drivers(confirmed)} confirmed this in the last month`
        + (who === 'confirmed' ? ', including you' : ''),
    };
  }

  if (confirmed === 0) {
    return {
      confirmed, changed, mine: who, tone: 'disputed',
      text: `${drivers(changed)} said this one has changed`
        + (who === 'changed' ? ', including you' : ''),
    };
  }

  // BOTH SIDES ARE SHOWN, ALWAYS, and neither is turned into a ruling. Two
  // drivers saying a car park is gone and nine saying it is fine is a spot
  // worth a second look, not a spot to pull off the map — the two may have
  // arrived during resurfacing, and a spot deletable on two taps is a spot
  // anybody can vandalise off the map. Same reasoning as the report flag.
  return {
    confirmed, changed, mine: who,
    tone: changed >= confirmed ? 'disputed' : 'confirmed',
    text: `${confirmed} confirmed this in the last month, ${changed} said it has changed`,
  };
};

/**
 * One map of "what I said about which spot", out of what is on the device.
 *
 * Before this there were two localStorage keys doing half the job each:
 * `pe_votes` ({id: true}) for Still here and `pe_ratings` ({id: 'changed'})
 * for Changed. Both are read here so a driver who has been tapping for months
 * still sees their own answers on the buttons.
 *
 * DELIBERATELY NOT SENT TO THE SERVER. Replaying an old local tap as a signal
 * would stamp it with today's date, and the sheet leads with "confirmed in the
 * last month" — so a year of stale taps would arrive as fresh evidence. They
 * stay as this device's memory of what it said; the counts start from the day
 * this shipped and are true.
 */
export const mergeLegacySignals = (current, votes = {}, ratings = {}) => {
  if (current && typeof current === 'object') return { ...current };
  const out = {};
  for (const [id, v] of Object.entries(ratings || {})) {
    if (v === 'changed') out[id] = 'changed';
  }
  // A confirmation wins a tie: pe_votes was write-once (the button disabled
  // itself), while pe_ratings could be toggled, so a spot in both was
  // confirmed and then un-changed rather than the other way round.
  for (const [id, v] of Object.entries(votes || {})) {
    if (v) out[id] = 'confirmed';
  }
  return out;
};

/** Tapping the same answer again takes it back. */
export const nextSignal = (mine, tapped) => (mine === tapped ? null : tapped);
