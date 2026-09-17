// Featured Partner matching + tracking. A partner is a local business featured
// on a nearby bookable space (contextual, one card per space). Kept tiny on
// purpose — fewer than fifty partners, so distance is computed in JS, no PostGIS.
import { supabase, isSupabaseEnabled } from './supabase';
import { track } from './analytics';
import { CARD_TIERS, rendersCard, sortWeight } from './partnerTiers';

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
      // Only the paying tiers are even fetched. A 'listed' partner gets a name
      // and a pin, which is what free buys — filtering in the query rather than
      // after it means their details never reach the client at all.
      .select('id, slug, name, name_irish, tagline, description, logo_url, photo_url, photo_urls, link_url, address, lat, lng, radius_m, priority, tier')
      .in('tier', CARD_TIERS);
    if (error || !data?.length) return null;
    const matches = data
      // Belt and braces on the query filter. If the `.in()` above is ever
      // dropped or the column comes back null, the card still does not render:
      // rendersCard() treats anything it does not recognise as no card, which
      // is the direction that fails safe.
      .filter((p) => rendersCard(p.tier))
      .map((p) => ({ ...p, distance_m: distanceMetres(listingLat, listingLng, p.lat, p.lng) }))
      .filter((p) => p.distance_m <= p.radius_m)
      // Sponsored first, then the hand-tuned priority, then distance. The boost
      // is ADDED to priority rather than replacing it, so the ordering Marty
      // set by hand still holds inside each tier.
      .sort((a, b) => sortWeight(b) - sortWeight(a) || a.distance_m - b.distance_m);
    return matches[0] ?? null;
  } catch {
    return null;
  }
}

// Fire-and-forget impression/click tracking. Never surfaces to the user.
//
// Writes BOTH stores on purpose. partner_events is what the existing partner
// stats card reads and it has 2,000-odd rows of history that would be orphaned
// by a switch; app_events is what lets a partner impression sit in the same
// table as the booking it may have led to. Dropping either would cost
// something real, so this one function keeps them in step.
export function trackPartnerEvent(partnerId, listingId, eventType) {
  if (!isSupabaseEnabled) return;
  try {
    supabase.from('partner_events').insert({ partner_id: partnerId, listing_id: listingId || null, event_type: eventType }).then(() => {}, () => {});
  } catch { /* analytics must never block */ }
  try {
    const name = eventType === 'click' ? 'partner_click'
      : eventType === 'impression' ? 'partner_impression' : null;
    if (name) track(name, {}, { partnerId, listingId: listingId || null });
  } catch { /* analytics must never block */ }
}
