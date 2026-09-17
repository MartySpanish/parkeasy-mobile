// Thanking the people the map is made of.
//
// 744 spots, 89 gems, the photos and the restriction notes all came from
// drivers, and nothing has ever thanked them for it. Points convert to Premium
// days — a thing that already exists and already has a price — because a
// balance that buys nothing is a number a company invented to thank you with.
//
// There is no path from here to awarding anything. award_points() is granted to
// service_role only and is called by the admin API when a human approves
// something; this module can read a balance and spend it, and that is all.
import { supabase, isSupabaseEnabled } from '../supabase';

export { EARN_WAYS, pointsSummary, ledgerLabel, LEDGER_LABELS } from './pointsCore';

/** The signed-in driver's balance, or null when there is nothing to show. */
export async function fetchPoints() {
  if (!isSupabaseEnabled) return null;
  try {
    const { data, error } = await supabase.rpc('my_points');
    if (error || !data || data.signed_in === false) return null;
    return data;
  } catch { return null; }
}

/**
 * Spend it.
 *
 * @returns the payload from redeem_points(): `{ ok: true, days, until, balance }`
 *   or `{ ok: false, reason }`. The reason is passed through rather than
 *   flattened to false, so the UI can say "not enough yet" instead of
 *   "something went wrong" — the two are not the same and only one is the
 *   driver's business.
 */
export async function redeemPoints() {
  if (!isSupabaseEnabled) return { ok: false, reason: 'offline' };
  try {
    const { data, error } = await supabase.rpc('redeem_points');
    if (error || !data) return { ok: false, reason: 'failed' };
    return data;
  } catch { return { ok: false, reason: 'failed' }; }
}

/**
 * The driver's own ledger, newest first.
 *
 * Read straight from the table: contribution_points has one policy, a driver
 * reading their own rows, so this returns theirs and nobody else's however the
 * query is written.
 */
export async function fetchLedger(limit = 20) {
  if (!isSupabaseEnabled) return [];
  try {
    const { data, error } = await supabase
      .from('contribution_points')
      .select('id,kind,ref,points,created_at')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data;
  } catch { return []; }
}

export default fetchPoints;
