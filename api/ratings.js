// Two-way star ratings (item 6).
//   POST /api/ratings  { bookingId, stars, comment }  → submit
//   GET  /api/ratings?pending=1                        → bookings awaiting my rating
//
// Direction is DERIVED from who the caller is on the booking — never trusted
// from the client. The caller must be a party to that booking, the booking must
// be in a terminal state (completed / no-show), and within the rating window.
const RATING_WINDOW_DAYS = parseInt(process.env.RATING_WINDOW_DAYS || '14', 10);

const ALLOWED_ORIGINS = /^https:\/\/(www\.)?parkeasy\.uk$|\.vercel\.app$/;
function applyCors(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  }
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  return false;
}

// A booking can be rated once it's genuinely over: completed, or the driver
// no-showed / cancelled late (the host should still be able to flag that).
// A booking cancelled before it started has nothing to rate.
const isRateable = (b) => {
  if (b.status === 'completed') return true;
  if (b.status === 'cancelled' && b.refund_status === 'denied_late') return true;
  // Paid bookings whose end time has passed count as completed in practice.
  if (b.status === 'paid' && b.ends_at && Date.parse(b.ends_at) < Date.now()) return true;
  return false;
};

export default async function handler(req, res) {
  if (applyCors(req, res)) return;

  const URL_ = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const ANON = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL_ || !ANON || !SERVICE) return res.status(500).json({ error: 'Not configured' });

  const jwt = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return res.status(401).json({ error: 'Sign in to rate' });
  let caller;
  try {
    const u = await fetch(`${URL_}/auth/v1/user`, { headers: { Authorization: `Bearer ${jwt}`, apikey: ANON } });
    if (!u.ok) return res.status(401).json({ error: 'Invalid session' });
    caller = await u.json();
  } catch { return res.status(401).json({ error: 'Auth check failed' }); }

  const svc = { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE, 'Content-Type': 'application/json' };
  const windowMs = RATING_WINDOW_DAYS * 86400000;

  // ── GET: which of my finished bookings still need a rating? ──
  if (req.method === 'GET') {
    try {
      const since = new Date(Date.now() - windowMs).toISOString();
      const br = await fetch(`${URL_}/rest/v1/bookings?or=(driver_id.eq.${caller.id},host_id.eq.${caller.id})&ends_at=gte.${since}&select=id,listing_id,host_id,driver_id,status,refund_status,ends_at&order=ends_at.desc&limit=20`, { headers: svc });
      const rows = br.ok ? await br.json() : [];
      const done = rows.filter(isRateable);
      if (!done.length) return res.status(200).json({ pending: [] });
      const ids = done.map(b => b.id).join(',');
      const rr = await fetch(`${URL_}/rest/v1/ratings?booking_id=in.(${ids})&select=booking_id,direction`, { headers: svc });
      const existing = rr.ok ? await rr.json() : [];
      const pending = done.filter(b => {
        const dir = b.driver_id === caller.id ? 'driver_to_host' : 'host_to_driver';
        return !existing.some(r => r.booking_id === b.id && r.direction === dir);
      }).map(b => ({ bookingId: b.id, listingId: b.listing_id, direction: b.driver_id === caller.id ? 'driver_to_host' : 'host_to_driver' }));
      return res.status(200).json({ pending });
    } catch (e) {
      console.error('ratings GET', e);
      return res.status(200).json({ pending: [] });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const bookingId = body?.bookingId;
  const stars = parseInt(body?.stars, 10);
  const comment = typeof body?.comment === 'string' ? body.comment.trim().slice(0, 500) : null;
  if (!bookingId) return res.status(400).json({ error: 'Missing bookingId' });
  if (!(stars >= 1 && stars <= 5)) return res.status(400).json({ error: 'Stars must be 1–5' });

  try {
    const br = await fetch(`${URL_}/rest/v1/bookings?id=eq.${encodeURIComponent(bookingId)}&select=*`, { headers: svc });
    const b = (await br.json())?.[0];
    if (!b) return res.status(404).json({ error: 'Booking not found' });

    // Direction derived from the caller's role on THIS booking.
    let direction, rateeId, listingId = null;
    if (b.driver_id === caller.id)      { direction = 'driver_to_host';  rateeId = b.host_id;   listingId = b.listing_id; }
    else if (b.host_id === caller.id)   { direction = 'host_to_driver';  rateeId = b.driver_id; }
    else return res.status(403).json({ error: 'Not your booking' });

    if (!isRateable(b)) return res.status(400).json({ error: 'You can rate once the booking is finished' });
    const endedMs = b.ends_at ? Date.parse(b.ends_at) : Date.parse(b.updated_at || b.created_at);
    if (Number.isFinite(endedMs) && Date.now() - endedMs > windowMs) {
      return res.status(400).json({ error: `Ratings close ${RATING_WINDOW_DAYS} days after a booking` });
    }

    const ins = await fetch(`${URL_}/rest/v1/ratings`, {
      method: 'POST', headers: { ...svc, Prefer: 'return=representation' },
      body: JSON.stringify({ booking_id: b.id, rater_id: caller.id, ratee_id: rateeId || null, listing_id: listingId, direction, stars, comment: comment || null }),
    });
    if (ins.status === 409) return res.status(409).json({ error: 'You’ve already rated this booking' });
    if (!ins.ok) return res.status(502).json({ error: 'Could not save your rating', detail: await ins.text().catch(() => '') });

    return res.status(200).json({ ok: true, direction, stars });
  } catch (e) {
    console.error('ratings POST', e);
    return res.status(500).json({ error: 'Could not save your rating' });
  }
}
