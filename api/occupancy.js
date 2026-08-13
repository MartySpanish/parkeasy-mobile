// Live "in use" signal for spots, fed by the in-app parking timer.
//
//   GET  /api/occupancy   → { counts: {"<spotId>": 2}, heading: {"<spotId>": 1} }
//   POST /api/occupancy   { spotId, key, action:'start'|'end', kind:'parked'|'heading' }
//
// Two kinds of signal, because they mean different things and expire at
// different speeds. 'parked' comes from the in-app timer — someone is there
// now, good for four hours. 'heading' is a driver on their way, and lasts
// thirty minutes: a stale claim on a free kerbside space is worse than none,
// because it sends the next driver past somewhere that is actually empty.
//
// Guest-friendly by design: the whole app works without an account, so this
// takes an opaque client key rather than a user id. That key is generated on
// the device, never leaves it except as an opaque string, and is only used so
// a driver can end the session they started.
//
// The table has RLS on and no policies — it is reachable only through here with
// the service role, and only ever read as an aggregate.
const ALLOWED_ORIGINS = /^https:\/\/(www\.)?parkeasy\.uk$|\.vercel\.app$/;
function applyCors(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  return false;
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  const URL_ = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL_ || !SERVICE) return res.status(500).json({ error: 'Not configured' });
  const svc = { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE, 'Content-Type': 'application/json' };

  if (req.method === 'GET') {
    try {
      const r = await fetch(`${URL_}/rest/v1/spot_occupancy_live?select=spot_id,in_use,heading`, { headers: svc });
      const rows = r.ok ? await r.json() : [];
      const counts  = Object.fromEntries(rows.filter(x => x.in_use).map(x => [String(x.spot_id), x.in_use]));
      const heading = Object.fromEntries(rows.filter(x => x.heading).map(x => [String(x.spot_id), x.heading]));
      // Short cache: this is a live signal, but a few seconds of staleness is
      // fine and keeps a busy map from hammering the database.
      res.setHeader('Cache-Control', 'public, max-age=20');
      return res.status(200).json({ counts, heading });
    } catch {
      // Never fail the map over a nice-to-have. No counts just means no badges.
      return res.status(200).json({ counts: {}, heading: {} });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const spotId = String(body?.spotId ?? '').slice(0, 64).trim();
  const key    = String(body?.key ?? '').slice(0, 64).trim();
  const action = body?.action === 'end' ? 'end' : 'start';
  // Anything unrecognised is treated as the timer signal, which is the
  // conservative default: it is the one that says "a driver is actually here".
  const kind   = body?.kind === 'heading' ? 'heading' : 'parked';
  const city   = String(body?.city ?? '').slice(0, 40).trim() || null;
  if (!spotId || !key) return res.status(400).json({ error: 'Missing spotId or key' });

  try {
    if (action === 'end') {
      await fetch(`${URL_}/rest/v1/spot_occupancy?spot_id=eq.${encodeURIComponent(spotId)}&client_key=eq.${encodeURIComponent(key)}&kind=eq.${kind}&ended_at=is.null`, {
        method: 'PATCH', headers: svc, body: JSON.stringify({ ended_at: new Date().toISOString() }),
      });
      return res.status(200).json({ ok: true });
    }

    const ins = await fetch(`${URL_}/rest/v1/spot_occupancy`, {
      method: 'POST', headers: svc,
      body: JSON.stringify({ spot_id: spotId, client_key: key, city, kind }),
    });
    // 409 = the partial unique index fired: this device already has an open
    // claim of this kind on this spot. That is the correct outcome, not an
    // error — it is what stops one phone counting as five drivers. The index
    // is per-kind, so saying "heading" and then starting a timer on arrival
    // both land.
    if (!ins.ok && ins.status !== 409) {
      return res.status(502).json({ error: 'Could not record' });
    }
    return res.status(200).json({ ok: true });
  } catch {
    return res.status(200).json({ ok: false });
  }
}
