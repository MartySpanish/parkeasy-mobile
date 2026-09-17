// Following a venue, so the alert arrives without the app being open.
//
// Keyed on the analytics session rather than an account: a driver who wants to
// know about Windsor Park does not need to sign up to want it, and the session
// id is the same anonymous id push_subscriptions is keyed on — so the sweep can
// find a browser to push to.
import { supabase, isSupabaseEnabled } from '../supabase';
import { sessionId } from '../analytics';

/**
 * Follow or unfollow a venue.
 *
 * @returns whether the venue is followed AFTER the call, as the server sees it.
 *   The button reflects that rather than what the tap assumed — an optimistic
 *   toggle that the server refused (at the cap, say) leaves somebody believing
 *   they will be told about a fixture they will hear nothing about.
 */
export async function setEventAlert(venue, on = true) {
  if (!isSupabaseEnabled || !venue) return false;
  try {
    const { data, error } = await supabase.rpc('set_event_alert', {
      p_session_id: sessionId(),
      p_venue: String(venue),
      p_on: Boolean(on),
    });
    if (error) return false;
    return data === true;
  } catch { return false; }
}

/** The venue keys this browser follows, as a Set. */
export async function fetchEventAlerts() {
  if (!isSupabaseEnabled) return new Set();
  try {
    const { data, error } = await supabase.rpc('my_event_alerts', { p_session_id: sessionId() });
    if (error || !Array.isArray(data)) return new Set();
    // A set-returning function comes back as an array of scalars through
    // PostgREST, but a single-column row object is also possible depending on
    // how it is called — both shapes are handled rather than one being assumed.
    return new Set(data.map(r => (typeof r === 'string' ? r : r?.my_event_alerts)).filter(Boolean));
  } catch { return new Set(); }
}

export default setEventAlert;
