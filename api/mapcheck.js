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
  // TWO DIFFERENT CONSOLE PAGES, AND THE FIRST VERSION OF THIS CONFLATED THEM.
  // They read almost the same in prose and are nothing alike to fix:
  //
  //   SERVICE_DISABLED        the API is switched off for the PROJECT.
  //                           Fix in APIs & Services -> Library.
  //   API_KEY_SERVICE_BLOCKED the API is on, but THIS KEY's "API restrictions"
  //                           allowlist does not include it. The project is
  //                           fine; the key is the thing refusing.
  //                           Fix in Credentials -> the key -> API restrictions.
  //
  // This endpoint's whole justification is naming the right one, and the live
  // probe came back API_KEY_SERVICE_BLOCKED while the first draft would have
  // sent somebody to Library to enable an API that was already enabled.
  if (/API_KEY_SERVICE_BLOCKED/i.test(reason)
      || /not authorized to use this service|API restrictions/i.test(message)) {
    return 'The API is not on this KEY\'s allowlist. The project is fine — the key itself is refusing. '
      + 'In the Google Cloud console: Credentials -> open the key behind VITE_GOOGLE_MAPS_KEY -> '
      + 'API restrictions -> add this API to the list (or set "Don\'t restrict key" to test). '
      + 'Takes a few minutes to propagate.';
  }
  if (/SERVICE_DISABLED/i.test(reason)
      || /has not been used in project|is disabled/i.test(message)) {
    return 'The API is NOT ENABLED on the project that owns this key. '
      + 'In the Google Cloud console: APIs & Services -> Library -> enable it. '
      + 'It can take a few minutes to propagate.';
  }
  if (/BILLING|billing/i.test(reason) || /billing/i.test(message)) {
    return 'The project has no active billing account. Map Tiles is a paid API and will not serve a session without one.';
  }
  if (/API_KEY_HTTP_REFERRER_BLOCKED/i.test(reason) || /referer|referrer/i.test(message)) {
    return 'The key\'s HTTP-referrer restriction does not allow parkeasy.uk. This call DID declare that referrer and was still refused, so this is the blocker for the real site too: add parkeasy.uk/* (and *.vercel.app/* for previews) to the key\'s allowed referrers.';
  }
  if (httpStatus === 403) {
    return 'Google refused the key (HTTP 403) without naming a reason. Usually the API is not enabled, or a key restriction excludes this caller.';
  }
  return message ? 'Google refused it. Its own message is in `googleSaid`.' : 'No session and no error message — treat as unavailable.';
}

/**
 * The site the browser would report itself as.
 *
 * WHY THIS IS SENT. The first version of this endpoint called with no Referer,
 * which is what a server does, and Google answered
 * API_KEY_HTTP_REFERRER_BLOCKED - "Requests from referer <empty> are blocked."
 * That is a true answer to a question nobody asked: of course a server with no
 * referrer is blocked by a referrer restriction. It said nothing about whether
 * the BROWSER is blocked, which is the only thing anyone wants to know, and a
 * diagnostic that cannot answer its own question is not worth deploying.
 *
 * So the probe is run twice: once as a bare server call, and once declaring the
 * referrer a real visitor's browser would send. Between them the three failure
 * modes finally separate:
 *
 *   referred call succeeds            the API and billing are fine; whatever
 *                                     the app is doing wrong is client-side
 *                                     (almost always the cached token)
 *   referred call SERVICE_DISABLED    the Map Tiles API is genuinely off
 *   referred call still referrer-     parkeasy.uk is not on the key's allowed
 *     blocked                         referrer list
 */
const SITE_REFERRER = 'https://parkeasy.uk/';

/** One createSession attempt, with or without a declared referrer. */
async function sessionAttempt(key, doFetch, referrer) {
  const r = await doFetch(`${TILE_SESSION}?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(referrer ? { Referer: referrer } : {}),
    },
    body: JSON.stringify({ mapType: 'roadmap', language: 'en-GB', region: 'GB' }),
  });
  const text = await r.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* not JSON: keep the text */ }
  return { r, body, text };
}

export async function checkMapTiles(key, fetchImpl) {
  if (!key) {
    return { ok: false, configured: false,
      diagnosis: 'VITE_GOOGLE_MAPS_KEY is not set in this environment, so the app never even attempts Google. Add it in Vercel.' };
  }
  const doFetch = fetchImpl || fetch;
  try {
    // The one that matters: as the browser would be seen.
    const { r, body, text } = await sessionAttempt(key, doFetch, SITE_REFERRER);
    void text;
    const r0 = await doFetch(`${TILE_SESSION}?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Byte-for-byte what buildSessionRequest() sends, minus the retina
      // variant: a session is bound to its configuration, so asking with a
      // different body would not prove the app's own request works.
      body: JSON.stringify({ mapType: 'roadmap', language: 'en-GB', region: 'GB' }),
    });
    const asServer = { httpStatus: r0.status, ok: r0.ok };

    if (r.ok && body?.session) {
      return {
        ok: true, configured: true, httpStatus: r.status,
        // NOT the token itself — it is a bearer credential for billed tiles.
        sessionReceived: true,
        expiry: body.expiry ? new Date(Number(body.expiry) * 1000).toISOString() : null,
        asServer,
        diagnosis: 'Map Tiles IS working for a request carrying parkeasy.uk as its referrer — so the API is enabled, billing is live and the domain is allowed. If the app still shows OpenStreetMap, the fault is client-side: almost always a stale cached token. Clear the localStorage key "parkeasy.googleTileSession.v1" and hard-refresh.',
      };
    }
    return {
      ok: false, configured: true, httpStatus: r.status, sessionReceived: false,
      asServer,
      googleSaid: scrub(body?.error?.message || '', key),
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
      // Reuse the reason-code logic rather than guessing between three causes:
      // the metadata endpoint reports a key restriction in words, and that is
      // a different fix from the API being off.
      const why = diagnose(r.status, { error: { message: body?.error_message || '' } });
      return { ok: false, configured: true, status,
        googleSaid: scrub(body?.error_message, key),
        diagnosis: `${why} Until then spot cards show their icon instead of a photo. `
          + 'Street View Static is a separate product from Map Tiles and needs its own entry.' };
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
