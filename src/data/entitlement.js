// Who is Premium, and why the app kept disagreeing with the database about it.
//
// WHAT WENT WRONG, exactly. There were two answers to "is this person
// Premium?" and nothing reconciled them.
//
//   THE DATABASE said: public.has_premium() — a promo_redemptions row with a
//   future expires_at, matched on user_id or on the email in the JWT. That is
//   the function the RLS policy on public.hidden_gems calls, so it is what
//   actually decides whether the 133 gems come back.
//
//   THE APP said: localStorage. src/App.jsx opened with
//     useState(() => ls.get('pe_premium', false)
//                 || ls.get('pe_premium_until', 0) > Date.now())
//   and that was the whole of it.
//
// `pe_premium` is a BOOLEAN WITH NO EXPIRY, written in five places — including
// straight from `?premium=success` in the URL, which is set on return from
// Stripe before any webhook has confirmed anything, and which anybody can type.
// No code path anywhere ever set it back to false. So once true on a device, it
// was true forever.
//
// THE STATE THAT PRODUCED THE BUG REPORT. The owner's own phone: local flag on,
// no promo_redemptions row at all. The header rendered "★ Premium ✓", and
// because isPremium was true, ListCard skipped its locked branch and drew the
// UNLOCKED card over TEASER data — hidden_gems returned nothing under RLS, so
// fetchGems() had fallen back to hidden_gems_teaser, where every row is
// `name: t.name || 'Hidden gem'` and the pin is snapped to a ~500m grid.
//
// A full-price card with a placeholder name, an approximate pin, and no
// explanation. Not even the "Unlock ★" card that would have said what was
// wrong. The worst of both states, and silent.
//
// IT CUTS THE OTHER WAY TOO, which is the expensive direction: a real
// subscriber whose entitlement row is keyed to an email they did not sign up
// with gets the badge from their device and no gems from the database. They
// have paid and the product is missing.
//
// THE RULE THIS FILE IMPLEMENTS. The database is the authority, because it is
// the thing that actually hands over the data; has_premium() is already
// SECURITY DEFINER and granted to anon and authenticated, so the client can
// call it and get the very boolean the RLS gate uses. localStorage drops to
// what it should always have been: an offline cache of the last answer.
//
//   server says yes          -> Premium
//   server says no           -> not Premium  (the half that never existed)
//   server cannot be reached -> whatever the device last knew
//
// That last line is not a loophole, it is the point: a subscriber on the train
// with no signal must not be demoted by a failed request. An unreachable
// server is not a "no".
//
// AND ONE GRACE WINDOW, because the new "no" has a false positive. Stripe
// returns the buyer to /?premium=success and the webhook writes the
// promo_redemptions row a moment later. Between those two events the server
// honestly answers false, and without this the buyer would watch Premium
// switch itself off seconds after paying. So a recent checkout holds the
// entitlement open for PREMIUM_GRACE_MS while the webhook lands. It expires on
// its own; it is a window, not a flag.

/** How long a just-completed checkout outranks a server "no". */
export const PREMIUM_GRACE_MS = 15 * 60 * 1000;

/** The localStorage keys this module reads. Named here so the test can too. */
export const LOCAL_KEYS = {
  flag:  'pe_premium',        // lifetime/subscription — boolean, no expiry
  until: 'pe_premium_until',  // time-limited grant — epoch ms
  paid:  'pe_premium_paid_at',// when checkout last returned — epoch ms
};

/**
 * The device's last known answer.
 *
 * `get(key, fallback)` is passed in rather than imported so this stays pure and
 * a test can drive it without a DOM.
 */
export function cachedPremium(get, nowMs = Date.now()) {
  const until = Number(get(LOCAL_KEYS.until, 0));
  return get(LOCAL_KEYS.flag, false) === true
    || (Number.isFinite(until) && until > nowMs);
}

/**
 * Is a checkout recent enough that the webhook may not have landed yet?
 *
 * TWO COMPARISONS, AND NOTHING IN FRONT OF THEM. The first version opened with
 * `if (paidAtMs == null || paidAtMs === '') return false;` and then an
 * `Number.isFinite` guard, on the Number(null) === 0 reasoning that has caught
 * this codebase four times (distanceLabel, median, hasCoords, offsetM). The
 * mutation pass deleted that null guard and every test still passed, which was
 * the correct verdict: here the trap does not bite, and a guard against it is
 * a line no test can ever justify.
 *
 * It does not bite because of what the value MEANS. Number(null) and
 * Number('') are both 0 — and 0 as an epoch is 1 January 1970, which is not
 * within fifteen minutes of now, so the recency comparison rejects it for the
 * right reason rather than by luck. NaN, from undefined or from a string,
 * fails every comparison it appears in, so it is rejected too. Adding guards
 * for either would be two more lines shadowing the two that do the work, and
 * the house rule on an inert guard is to simplify the code, not to accept a
 * survivor.
 *
 * So both operators below are load-bearing and provable:
 *   `> nowMs - PREMIUM_GRACE_MS`  the window, and its exclusive lower edge
 *   `<= nowMs + PREMIUM_GRACE_MS` a clock set forward, or a hand-edited value,
 *                                 must not buy an endless one
 */
export function withinGrace(paidAtMs, nowMs = Date.now()) {
  const at = Number(paidAtMs);
  return at > nowMs - PREMIUM_GRACE_MS && at <= nowMs + PREMIUM_GRACE_MS;
}

/**
 * Fold the server's answer and the device's cache into one boolean.
 *
 * @param server  true | false | null — null means "could not ask"
 * @param cached  what the device last knew
 * @param paidAt  epoch ms of the last completed checkout, or null
 */
export function resolvePremium({ server, cached, paidAt = null, nowMs = Date.now() }) {
  if (server === true) return true;
  if (server === false) return withinGrace(paidAt, nowMs);
  // null/undefined: unreachable, mid-flight, or Supabase disabled.
  return cached === true;
}

/**
 * A teaser row is a locked gem, whatever any flag says.
 *
 * THE SECOND HALF OF THE FIX, and the one that makes the screenshot
 * structurally impossible rather than merely unlikely. Even with the server as
 * the authority there are moments the two can differ — the RPC in flight on
 * first paint, a session restoring, a row written between two requests. In
 * every one of those the honest question is not "what does the flag say" but
 * "do we actually HAVE this gem's data".
 *
 * hidden_gems_teaser rows arrive from src/data/hiddenGems.js carrying
 * `approximate: true` (set as `!t.is_taster`, so the five tasters are exempt
 * and keep their real detail). If that is set, the name is the placeholder
 * string "Hidden gem" and the pin is snapped to a ~500m grid: there is nothing
 * to unlock and rendering the open card is a lie in both directions.
 */
export const isTeaserRow = (spot) => spot?.approximate === true;

/**
 * Ask the database. Resolves true, false, or null when it could not be asked.
 *
 * Never throws: every failure is null, which resolvePremium() reads as "keep
 * what the device knew" rather than as a demotion.
 */
export async function fetchPremium(client) {
  if (!client) return null;
  try {
    const { data, error } = await client.rpc('has_premium');
    if (error) return null;
    return data === true;
  } catch {
    return null;
  }
}
