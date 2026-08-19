// Hidden gems, read from the database instead of the JavaScript bundle.
//
// WHAT CHANGES AND WHAT DELIBERATELY DOES NOT. The gems are now rows in
// public.hidden_gems, so they can be counted, published, retired and joined to
// a listing without a deploy. The SHAPE handed back is byte-for-byte the spot
// object App.jsx already renders — same keys, same badge, same types — so
// nothing downstream needed rewriting to switch source.
//
// TWO QUERIES, BECAUSE THERE ARE TWO AUDIENCES:
//
//   a subscriber reads hidden_gems and gets everything;
//   everybody else reads hidden_gems_teaser and gets an area name and a pin
//   snapped to a ~500m grid — plus the five taster gems in full, which are
//   given away on purpose.
//
// The RLS policy decides which, not this file. Calling the subscriber query
// without a subscription returns zero rows rather than a 403, so the fallback
// below is what a non-subscriber actually lands on.
//
// ⚠️ THE BUNDLE STILL CONTAINS THE GEMS. This module makes the DATABASE the
// source of truth; it does not yet remove the hardcoded copies from
// src/App.jsx and friends, which stay as an offline fallback while the database
// path proves itself in production. Until those are deleted, the exact
// coordinates of all 89 gems remain readable by anyone who opens devtools —
// the RLS gate is real, the bundle leak is not yet closed. That deletion is a
// follow-up PR and it is the one that finishes the job.
import { supabase, isSupabaseEnabled } from '../supabase';

/** A hidden_gems row in the shape App.jsx renders. */
const toSpot = (g) => ({
  // The integer the app has always used, so saved spots, occupancy counts and
  // deep links keep working across the switch.
  id: g.legacy_id != null && /^\d+$/.test(g.legacy_id) ? Number(g.legacy_id) : (g.legacy_id || g.id),
  gemId: g.id,
  name: g.name,
  near: g.near || '',
  tags: g.tags || [],
  badge: 'hidden_gem',
  dist: g.dist_miles != null ? Number(g.dist_miles) : 0,
  walk: g.walk || '',
  restriction: g.restriction || '',
  notes: g.notes || '',
  lat: g.lat, lng: g.lng,
  by: g.submitted_by || 'ParkEasy',
  votes: g.votes || 0,
  photo: g.photo_url || null,
  price: null,
  spaces: g.spaces_estimate ?? null,
  premium: g.premium ?? undefined,
  town: g.town || null,
  isTaster: g.is_taster === true,
});

/** The teaser shape: same keys, but only what a free user is allowed to have. */
const teaserToSpot = (t) => ({
  id: t.legacy_id != null && /^\d+$/.test(t.legacy_id) ? Number(t.legacy_id) : (t.legacy_id || t.id),
  gemId: t.id,
  // A non-taster teaser has no name by design. The locked card never showed one
  // anyway — it renders gatedLabel(spot) — so this loses nothing on screen and
  // stops the name leaving the database.
  name: t.name || 'Hidden gem',
  near: t.near || '',
  tags: t.tags || [],
  badge: 'hidden_gem',
  dist: 0,
  walk: t.walk || '',
  restriction: t.restriction || '',
  notes: t.notes || '',
  lat: t.approx_lat, lng: t.approx_lng,
  by: 'ParkEasy', votes: 0, photo: null, price: null,
  spaces: t.spaces_estimate ?? null,
  town: t.town || null,
  isTaster: t.is_taster === true,
  // Marks a pin the app must not present as kerb-accurate.
  approximate: !t.is_taster,
});

/**
 * Every published gem this caller is entitled to see.
 *
 * @returns {Promise<{spots: Array, source: 'db'|'teaser'|'none', error: string|null}>}
 *   `source` is reported rather than hidden so the caller can decide whether to
 *   fall back, and so a silent empty result cannot be mistaken for "there are
 *   no gems".
 */
export async function fetchGems() {
  if (!isSupabaseEnabled) return { spots: [], source: 'none', error: 'supabase disabled' };
  try {
    const { data, error } = await supabase
      .from('hidden_gems')
      .select('id,legacy_id,name,near,tags,restriction,notes,lat,lng,photo_url,spaces_estimate,dist_miles,walk,submitted_by,votes,premium,town,is_taster')
      .eq('status', 'published')
      .limit(1000);
    if (error) throw error;
    if (data?.length) return { spots: data.map(toSpot), source: 'db', error: null };

    // Zero rows is the normal answer for a free user — RLS filtered them all
    // out — so fall through to the teaser rather than treating it as a failure.
    const { data: teasers, error: tErr } = await supabase
      .from('hidden_gems_teaser')
      .select('id,legacy_id,near,town,spaces_estimate,is_taster,name,restriction,notes,tags,walk,approx_lat,approx_lng')
      .limit(1000);
    if (tErr) throw tErr;
    return { spots: (teasers || []).map(teaserToSpot), source: 'teaser', error: null };
  } catch (e) {
    return { spots: [], source: 'none', error: e?.message || String(e) };
  }
}

/** The public count, for the homepage and the Premium pitch. */
export async function fetchGemStats() {
  if (!isSupabaseEnabled) return null;
  try {
    const { data, error } = await supabase
      .from('hidden_gem_stats')
      .select('published,verified,towns')
      .maybeSingle();
    if (error) throw error;
    return data || null;
  } catch { return null; }
}

/**
 * Which kind of thing a spot_occupancy.spot_id points at.
 *
 * Mirrors public.resolve_spot(). THREE cases, not two — the third is the one
 * that would otherwise be dropped: four of the fourteen live ids (25, 43, 16,
 * 26) are ordinary free, official and timed spots, not gems, because the
 * "I'm heading there" button is offered on every free spot.
 */
export function resolveSpot(spotId, { gems = [], listings = [] } = {}) {
  const key = String(spotId ?? '');
  if (!key) return { kind: 'unknown' };
  if (key.startsWith('rental-')) {
    const id = key.slice(7);
    const listing = listings.find(l => String(l.listingId ?? l.id) === id);
    return listing ? { kind: 'listing', listing } : { kind: 'unknown' };
  }
  const gem = gems.find(g => String(g.id) === key);
  if (gem) return { kind: 'gem', gem };
  return { kind: 'legacy_spot', id: key };
}

export default fetchGems;
