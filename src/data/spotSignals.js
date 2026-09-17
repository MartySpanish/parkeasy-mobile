// "Is this still here?" — the answer now leaves the phone.
//
// The app has always asked. Under every spot sat 👍 Still here and 👎 Changed,
// and both wrote to localStorage: Still here to `pe_votes`, Changed to
// `pe_ratings`, which nothing ever read. So the single most valuable thing a
// driver can give ParkEasy — whether the 744 spots are still true — was
// collected half a million times and thrown away, while the sheet above the
// buttons said "Confirmed by 0 drivers".
//
// ONE ANSWER PER BROWSER PER SPOT. The database keys on (spot_key, source_id)
// so tapping fifty times is one confirmation and changing your mind moves the
// vote instead of counting on both sides. See the migration; that rule lives
// there, not here, because a client-side rule is a suggestion.
//
// THE COUNT COMES BACK FROM THE SERVER rather than being incremented locally.
// Guessing is precisely what was wrong before: "Confirmed by 1 driver" was true
// on one phone and false everywhere else.
import { supabase, isSupabaseEnabled } from '../supabase';
import { sessionId } from '../analytics';
import { SIGNALS } from './spotSignalsCore';

export { SIGNALS, signalSummary, mergeLegacySignals, nextSignal } from './spotSignalsCore';

/**
 * Say something about a spot.
 *
 * @returns the fresh counts for that spot, or null when it could not be sent.
 *   null is not "no signal": the caller keeps the answer on the device either
 *   way, so the button reflects what the driver said even with no database
 *   behind the build.
 */
export async function setSignal(spotId, signal) {
  if (!isSupabaseEnabled || !SIGNALS.includes(signal)) return null;
  try {
    const { data, error } = await supabase.rpc('set_spot_signal', {
      p_spot_key: String(spotId),
      p_source_id: sessionId(),
      p_signal: signal,
    });
    if (error || !data) return null;
    return data;
  } catch { return null; }
}

/** Take it back. */
export async function clearSignal(spotId) {
  if (!isSupabaseEnabled) return false;
  try {
    const { data } = await supabase.rpc('clear_spot_signal', {
      p_spot_key: String(spotId),
      p_source_id: sessionId(),
    });
    return data === true;
  } catch { return false; }
}

/**
 * Every spot's counts, keyed by spot id as a string.
 *
 * One read for the whole map rather than one per sheet: the view is a few
 * hundred rows of integers, and a request per spot opened is a request per spot
 * opened.
 */
export async function fetchSignalCounts() {
  if (!isSupabaseEnabled) return {};
  try {
    const { data, error } = await supabase
      .from('spot_signal_counts')
      .select('spot_key,confirmed,changed,confirmed_30d,changed_30d,last_confirmed_at');
    if (error || !data) return {};
    return Object.fromEntries(data.map(r => [r.spot_key, r]));
  } catch { return {}; }
}

export default setSignal;
