// Why the Google basemap is not drawing, answered from production.
//
// WHY THIS EXISTS. The Google path in src/mapTiles.js is complete and correct —
// every one of the five map surfaces goes through BaseTileLayer, the
// createSession request shape was checked against the live endpoint, and
// tile.googleapis.com is in both img-src and connect-src. When the map still
// falls back to OpenStreetMap, the cause is therefore never the code: it is the
// state of the Google Cloud project that owns the key. There are exactly three
// of those, and they are indistinguishable from the outside:
//
//   the Map Tiles API is not enabled on that project
//   the project has no billing account, or billing has lapsed
//   the key has an HTTP-referrer restriction that excludes the calling domain
//
// Up to now the only way to tell them apart was to open devtools on a phone and
// read the console.warn in ensureGoogleSession(). That is a poor way to settle a
// question that has now come up three times, and it cannot be read at all by
// anyone who is not sitting in front of the app.
//
// So this asks Google the same question the browser asks, from the server,
// where the key already lives in the environment, and reports the answer in
// words. It is a diagnostic, not a feature: it changes nothing and fixes
// nothing. What it does is replace "probably billing" with Google's own reason.
//
// THE KEY NEVER LEAVES. It is read from the environment, sent to Google, and
// never put in a response — not in a URL, not in an echoed request, and not
// inside a Google error message, which is scrubbed before it is returned. The
// only thing a caller learns is which of ParkEasy's Google APIs are switched
// on, which is not a secret: it is observable from the app's own network tab.
//
// IT IS CACHED AT THE EDGE because each call costs one createSession, and a
// session token is good for about two weeks — so there is no sense minting one
// per page refresh of a diagnostic. Five minutes is short enough to watch a
// console change take effect and long enough that this cannot be used to spend
// anybody's quota.

const TILE_SESSION = 'https://tile.googleapis.com/v1/createSession';
const SV_METADATA = 'https://maps.googleapis.com/maps/api/streetview/metadata';

// Belfast City Hall. Somewhere Street View certainly has coverage, so a
// ZERO_RESULTS here means something other than "this layby has no panorama".
const KNOWN_PANORAMA = '54.5966,-5.9301';

/** Google's message with any trace of the key taken out of it. */
export const scrub = (text, key) => {
  let s = String(text == null ? '' : text).slice(0, 400);
  if (key) {
    // The raw key, and its URL-encoded form, in case Google echoes the request.
    for (const form of [key, encodeURIComponent(key)]) {
      if (form) s = s.split(form).join('[key]');
    }
  }
  // And anything else shaped like a Google API key, in case the account is
  // holding more than one and an error names a different one.
  return s.replace(/AIza[0-9A-Za-z_-]{10,}/g, '[key]');
};

/**
 * What the three failure modes look like coming back from Google.
 *
 * Mapped to plain words rather than left as codes, because the whole point of
 * this endpoint is that somebody who is not reading mapTiles.js can act on it.
 */
export function diagnose(httpStatus, body) {
  const reason = body?.error?.details?.find(d => d.reason)?.reason
    || body?.error?.status || '';
  const message = body?.error?.message || '';

  if (/API_KEY_INVALID/i.test(reason) || /API key not valid/i.test(message)) {
    return 'The key itself is not valid for this API. Check VITE_GOOGLE_MAPS_KEY in Vercel matches a live key in the Google project.';
  }
  if (/SERVICE_DISABLED|API_KEY_SERVICE_BLOCKED/i.test(reason)
      || /has not been used in project|is disabled/i.test(message)) {
    return 'The Map Tiles API is NOT ENABLED on the project that owns this key. Enable it in the Google Cloud console; it can take a few minutes to propagate.';
  }
  if (/BILLING|billing/i.test(reason) || /billing/i.test(message)) {
    return 'The project has no active billing account. Map Tiles is a paid API and will not serve a session without one.';
  }
  if (/API_KEY_HTTP_REFERRER_BLOCKED/i.test(reason) || /referer|referrer/i.test(message)) {
    return 'The key has an HTTP-referrer restriction. This call came from a server with no referrer, so this result does not prove the browser is blocked — but if the app is also failing, add parkeasy.uk (and *.vercel.app for previews) to the key\'s allowed referrers.';
  }
  if (httpStatus === 403) {
    return 'Google refused the key (HTTP 403) without naming a reason. Usually the API is not enabled, or a key restriction excludes this caller.';
  }
  return message ? 'Google refused it. Its own message is in `googleSaid`.' : 'No session and no error message — treat as unavailable.';
}

export async function checkMapTiles(key, fetchImpl) {
  if (!key) {
    return { ok: false, configured: false,
      diagnosis: 'VITE_GOOGLE_MAPS_KEY is not set in this environment, so the app never even attempts Google. Add it in Vercel.' };
  }
  const doFetch = fetchImpl || fetch;
  try {
    const r = await doFetch(`${TILE_SESSION}?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Byte-for-byte what buildSessionRequest() sends, minus the retina
      // variant: a session is bound to its configuration, so asking with a
      // different body would not prove the app's own request works.
      body: JSON.stringify({ mapType: 'roadmap', language: 'en-GB', region: 'GB' }),
    });
    const text = await r.text();
    let body = null;
    try { body = JSON.parse(text); } catch { /* not JSON: keep the text */ }

    if (r.ok && body?.session) {
      return {
        ok: true, configured: true, httpStatus: r.status,
        // NOT the token itself — it is a bearer credential for billed tiles.
        sessionReceived: true,
        expiry: body.expiry ? new Date(Number(body.expiry) * 1000).toISOString() : null,
        diagnosis: 'Map Tiles is working. If the app still shows OpenStreetMap, the browser is holding a stale cached token: clear localStorage key "parkeasy.googleTileSession.v1" and hard-refresh.',
      };
    }
    return {
      ok: false, configured: true, httpStatus: r.status, sessionReceived: false,
      googleSaid: scrub(body?.error?.message || text, key),
      reason: body?.error?.details?.find(d => d.reason)?.reason || body?.error?.status || null,
      diagnosis: diagnose(r.status, body),
    };
  } catch (e) {
    return { ok: false, configured: true,
      diagnosis: 'The request to Google failed before it got an answer.',
      googleSaid: scrub(e?.message || String(e), key) };
  }
}

export async function checkStreetView(key, fetchImpl) {
  if (!key) return { ok: false, configured: false, diagnosis: 'No key configured.' };
  const doFetch = fetchImpl || fetch;
  try {
    const r = await doFetch(`${SV_METADATA}?location=${KNOWN_PANORAMA}&key=${encodeURIComponent(key)}`);
    const body = await r.json().catch(() => null);
    const status = body?.status || null;
    if (status === 'OK') {
      return { ok: true, configured: true, status,
        diagnosis: 'Street View Static is working. Spot cards will show real photos wherever a panorama exists.' };
    }
    if (status === 'REQUEST_DENIED') {
      return { ok: false, configured: true, status,
        googleSaid: scrub(body?.error_message, key),
        diagnosis: 'The Street View Static API is not enabled (or billing is off, or a key restriction blocks it). Spot cards will show their icon instead of a photo until this is fixed. This is separate from Map Tiles and has its own toggle.' };
    }
    return { ok: false, configured: true, status,
      googleSaid: scrub(body?.error_message, key),
      diagnosis: status === 'ZERO_RESULTS'
        ? 'Google reports no panorama at Belfast City Hall, which it certainly has. Treat this as a key or project problem rather than a coverage one.'
        : 'Unexpected status; see `status`.' };
  } catch (e) {
    return { ok: false, configured: true, diagnosis: 'The request to Google failed.', googleSaid: scrub(e?.message, key) };
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'GET only' });
  }

  const key = process.env.VITE_GOOGLE_MAPS_KEY || '';
  const [mapTiles, streetView] = await Promise.all([checkMapTiles(key), checkStreetView(key)]);

  // Five minutes: long enough that this cannot be used to burn quota, short
  // enough to watch a console change take effect.
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
  res.setHeader('X-Robots-Tag', 'noindex');
  return res.status(200).json({
    checkedAt: new Date().toISOString(),
    // Presence only. Never the value, and never enough of it to narrow a guess.
    keyConfigured: Boolean(key),
    cartoKeyConfigured: Boolean(process.env.VITE_CARTO_API_KEY),
    mapTiles,
    streetView,
    note: 'Diagnostic only. Nothing here changes app behaviour. The basemap falls back to OpenStreetMap whenever mapTiles.ok is false.',
  });
}
