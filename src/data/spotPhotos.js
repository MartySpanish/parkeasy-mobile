// Photos of a spot, taken by the drivers who park there.
//
// A hidden gem is a description of a place — "quiet residential street off the
// Glen Road", "small lay-by most people miss". That is enough to find the
// street and not enough to recognise the spot when you pull up, which is the
// moment the app is actually being used: from a car, often in the dark, often
// in the rain. A photo answers "is this it?" in a way no sentence does.
//
// Every photo is reviewed before it shows. A picture taken on a street will
// sometimes contain a number plate, a face or somebody's front door, and none
// of that is publishable on the strength of a tap.
//
// NO SUPABASE IMPORT HERE, ON PURPOSE. The client is passed in by the caller,
// which already holds it. That is not ceremony: the value of this file is its
// FAILURE paths — a HEIC photo an iPhone cannot encode, a dropped connection, a
// second tap on a slow network — and those are what a driver actually meets.
// Importing the client would drag in import.meta.env and make the whole module
// unloadable outside a bundler, so none of them could be tested.
//
// See tests/unit/spotPhotos.test.mjs.

/** The same key shape spot_occupancy uses: "66" for a gem, "rental-<uuid>". */
export const spotKeyOf = (spot) =>
  (spot?.rental && spot?.listingId) ? `rental-${spot.listingId}` : String(spot?.id ?? '');

/**
 * Approved photos for a set of spots, keyed by spot_key.
 *
 * Fetched in one query for the whole visible list rather than one per card —
 * a request per spot on a 40-row list is 40 requests for something nobody has
 * scrolled to yet.
 */
export async function fetchSpotPhotos(spotKeys = [], db = null) {
  if (!db || !spotKeys.length) return {};
  try {
    const { data, error } = await db
      .from('spot_photos_public')
      .select('id,spot_key,photo_url,caption,submitter_name,created_at')
      .in('spot_key', spotKeys.slice(0, 500))
      .order('created_at', { ascending: true });
    if (error || !data) return {};
    const out = {};
    for (const row of data) (out[row.spot_key] ||= []).push(row);
    return out;
  } catch { return {}; }
}

/** Approved photos for ONE spot — used when a detail sheet opens cold. */
export async function fetchPhotosForSpot(spotKey, db = null) {
  const map = await fetchSpotPhotos([spotKey], db);
  return map[spotKey] || [];
}

/**
 * Offer a photo of a spot for review.
 *
 * @param file      the File from the camera or picker
 * @param spot      the spot it belongs to
 * @param caption   one optional line — "entrance is round the back"
 * @param user      the signed-in user
 * @param upload    (file, uid, slot) => Promise<url>, injected so this module
 *                  does not need to know about storage buckets or HEIC
 * @param db        the Supabase client, passed in by the caller. See the note at
 *                  the top of this file for why it is not imported here.
 * @returns {Promise<{ok: true} | {ok: false, error: string}>}
 */
export async function submitSpotPhoto({ file, spot, caption, user, upload, db = null, enabled = true }) {
  if (!enabled || !db) return { ok: false, error: 'Photos need an account — sign in first.' };
  if (!user?.id) return { ok: false, error: 'Sign in to add a photo.' };
  if (!file) return { ok: false, error: 'Choose a photo first.' };

  let url;
  try {
    // Slot key includes the spot so two photos from one person in one second
    // cannot collide on the storage path.
    url = await upload(file, user.id, `spot-${spotKeyOf(spot)}`);
  } catch (e) {
    // uploadListingPhoto already produces messages a person can act on —
    // the HEIC one in particular tells an iPhone owner which setting to change.
    return { ok: false, error: e?.message || 'That photo could not be uploaded.' };
  }

  const { error } = await db.from('spot_photos').insert({
    spot_key: spotKeyOf(spot),
    photo_url: url,
    caption: (caption || '').trim().slice(0, 140) || null,
    submitted_by: user.id,
    // First name only. The credit under a photo is "Ciaran M", not an account.
    submitter_name: (user.name || '').split(' ').slice(0, 2).join(' ') || null,
  });

  if (error) {
    const m = String(error.message || '').toLowerCase();
    if (m.includes('duplicate') || m.includes('unique')) {
      return { ok: false, error: 'You have already sent a photo of this spot — it is waiting to be checked.' };
    }
    return { ok: false, error: 'Could not send that just now. Try again in a moment.' };
  }
  return { ok: true };
}

export default fetchSpotPhotos;
