// Featured Partner matching + tracking. A partner is a local business featured
// on a nearby bookable space (contextual, one card per space). Kept tiny on
// purpose — fewer than fifty partners, so distance is computed in JS, no PostGIS.
import { supabase, isSupabaseEnabled } from './supabase';

const EARTH_RADIUS_M = 6_371_000;

// Great-circle distance in metres between two WGS84 points.
export function distanceMetres(aLat, aLng, bLat, bLng) {
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

// Nearest live partner whose radius contains the listing, or null. RLS already
// filters to active + in-window rows, so an expired/inactive partner can never
// reach the client. Never throws — a partner card must not break a space.
export async function findPartnerForListing(listingLat, listingLng) {
  if (!isSupabaseEnabled || listingLat == null || listingLng == null) return null;
  try {
    const { data, error } = await supabase
      .from('partners')
      .select('id, slug, name, name_irish, tagline, description, logo_url, photo_url, photo_urls, link_url, address, lat, lng, radius_m, priority');
    if (error || !data?.length) return null;
    const matches = data
      .map((p) => ({ ...p, distance_m: distanceMetres(listingLat, listingLng, p.lat, p.lng) }))
      .filter((p) => p.distance_m <= p.radius_m)
      .sort((a, b) => b.priority - a.priority || a.distance_m - b.distance_m);
    return matches[0] ?? null;
  } catch {
    return null;
  }
}

// Fire-and-forget impression/click tracking. Never surfaces to the user.
export function trackPartnerEvent(partnerId, listingId, eventType) {
  if (!isSupabaseEnabled) return;
  try {
    supabase.from('partner_events').insert({ partner_id: partnerId, listing_id: listingId || null, event_type: eventType }).then(() => {}, () => {});
  } catch { /* analytics must never block */ }
}
