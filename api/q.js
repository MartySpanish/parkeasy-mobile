// GET /q/:code — the landing route every printed QR code points at.
//
// WHY qr_scans HAS ZERO ROWS. It is not that the write was broken: this route
// did not exist. 26 codes are in the database, 106 stickers and flyers were
// planned against them, and nothing in the app has ever handled /q/ — a scan
// fell through the SPA catch-all to the homepage, which looks like it worked
// and records nothing. Every scan since the first sticker went up is gone.
//
// A PHYSICAL STICKER MUST NEVER DEAD-END. It is on a wall in a barber's and
// cannot be edited. So every failure here still ends in a redirect: an unknown
// code, a database that will not answer, a missing lands_on — all of them send
// the driver to the app rather than showing them an error. The scan being lost
// is a smaller problem than the person being lost.
//
// WHAT IS RECORDED, AND WHAT IS NOT. The code, a session id, a truncated user
// agent and the referrer. No IP, no location, no attempt to identify anybody:
// this answers "is the Falls Road sticker working" and nothing else.
const FALLBACK = '/';

export default async function handler(req, res) {
  const URL_ = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // Lower-cased and stripped: the codes are short lowercase slugs, and a
  // sticker printed in caps or scanned with trailing punctuation must still
  // land. Bounded so a long path cannot be used to write junk rows.
  const raw = String(req.query?.code || '');
  const code = raw.toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);

  const go = (to) => {
    // 302, never 301. A permanent redirect would be cached by the browser and
    // every later scan of that sticker would skip this route entirely — the
    // counting would stop and nobody would know why.
    res.setHeader('Cache-Control', 'no-store');
    res.redirect(302, to || FALLBACK);
  };

  if (!code || !URL_ || !SERVICE) return go(FALLBACK);

  const svc = { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE, 'Content-Type': 'application/json' };

  try {
    const r = await fetch(`${URL_}/rest/v1/qr_codes?code=eq.${encodeURIComponent(code)}&select=code,lands_on,active`, { headers: svc });
    const row = r.ok ? (await r.json())?.[0] : null;

    // Recorded even when the code is unknown or switched off. A scan of a
    // sticker somebody retired is still a real person standing in front of it,
    // and that is worth knowing before the next print run.
    await fetch(`${URL_}/rest/v1/qr_scans`, {
      method: 'POST', headers: { ...svc, Prefer: 'return=minimal' },
      body: JSON.stringify({
        code,
        user_agent: String(req.headers['user-agent'] || '').slice(0, 300) || null,
        referrer: String(req.headers.referer || req.headers.referrer || '').slice(0, 300) || null,
      }),
    }).catch(e => console.error('qr scan write failed', code, String(e)));

    if (!row) {
      console.warn(`qr: unknown code "${code}" scanned — check the print run`);
      return go(FALLBACK);
    }
    // An inactive code still redirects. Taking somebody to a dead end because
    // a row was toggled off is worse than sending them to the app.
    return go(row.lands_on || FALLBACK);
  } catch (e) {
    console.error('qr landing failed', code, String(e));
    return go(FALLBACK);
  }
}
