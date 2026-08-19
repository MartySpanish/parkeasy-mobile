// "This is wrong now" — one tap, and everyone else is warned immediately.
//
// A spot that was right in March is wrong in September: the council paints
// lines, a barrier goes in, a residents' scheme starts. Until now the only way
// to say so was a mailto: link, and a mailto: link is a report nobody files.
//
// TWO THINGS HAPPEN, AND THE SECOND IS THE POINT. The spot is queued for
// re-review by a human — that part is slow and should be. But every other
// driver sees a "recently reported" flag straight away, because waiting for a
// human before warning anyone means the next fifty people drive to the same
// wrong place.
//
// The flag is deliberately soft. Two reports is not proof, and a spot pulled on
// two taps is a spot anybody can vandalise off the map. It says what it knows:
// somebody reported this, recently, and here is the count.
import { supabase, isSupabaseEnabled } from '../supabase';

export const REASONS = [
  { id: 'gone',        label: 'It’s gone',            hint: 'Barrier, building work, spaces removed' },
  { id: 'restricted',  label: 'Restrictions changed', hint: 'New hours, permit zone, charges' },
  { id: 'full_always', label: 'Always full',          hint: 'Never a space here any more' },
  { id: 'wrong',       label: 'Details are wrong',    hint: 'Wrong place, wrong price, wrong notes' },
];

/** Report a spot. Returns true when it was recorded. */
export async function reportSpot(spotId, reason, note) {
  if (!isSupabaseEnabled) return false;
  const { data: sess } = await supabase.auth.getSession();
  const { error } = await supabase.from('spot_reports').insert({
    // Text, because the map mixes community submissions (uuid) with the curated
    // seed data (integer ids) and a driver reporting a seeded spot is exactly
    // as useful.
    spot_key: String(spotId),
    reporter_id: sess?.session?.user?.id || null,
    reason: REASONS.some(r => r.id === reason) ? reason : 'wrong',
    note: (note || '').trim().slice(0, 500) || null,
  });
  return !error;
}

/**
 * Open report counts, keyed by spot id as a string.
 *
 * Counts only. The view exposes no reporter and no note — the flag beside a
 * spot is "two people said this is wrong this week", not a comment thread.
 */
export async function fetchReportCounts() {
  if (!isSupabaseEnabled) return {};
  try {
    const { data, error } = await supabase
      .from('spot_report_counts')
      .select('spot_key,reports_30d,last_reported_at');
    if (error || !data) return {};
    return Object.fromEntries(data.map(r => [r.spot_key, r]));
  } catch { return {}; }
}

/** How to describe a spot's open reports, or null when there is nothing to say. */
export function reportFlag(counts, spotId) {
  const row = counts?.[String(spotId)];
  const n = row?.reports_30d || 0;
  if (n < 1) return null;
  return {
    count: n,
    // Never "this spot is wrong". One person saying so is one person saying so,
    // and a spot pulled on two taps is a spot anybody can vandalise off the map.
    text: n === 1
      ? 'A driver reported a problem here recently — worth a second look.'
      : `${n} drivers reported a problem here recently — worth a second look.`,
  };
}

export default reportSpot;
