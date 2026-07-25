// POST /api/passes/redeem — book a slot using a pass credit instead of paying.
// Validates ownership/validity/overlap, atomically decrements the credit
// (redeem_pass_credit RPC — can't go negative), then creates a paid booking
// with zero charge amounts and pass_purchase_id set for host visibility.
const ALLOWED_ORIGINS = /^https:\/\/(www\.)?parkeasy\.uk$|\.vercel\.app$/;
function applyCors(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  }
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  return false;
}

export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const URL_ = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const ANON = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!URL_ || !ANON || !SERVICE) return res.status(500).json({ error: 'Not configured' });

  const jwt = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return res.status(401).json({ error: 'Sign in to use a pass' });
  let driver;
  try {
    const u = await fetch(`${URL_}/auth/v1/user`, { headers: { Authorization: `Bearer ${jwt}`, apikey: ANON } });
    if (!u.ok) return res.status(401).json({ error: 'Invalid session' });
    driver = await u.json();
  } catch { return res.status(401).json({ error: 'Auth check failed' }); }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const { purchaseId, startsAt } = body || {};
  const durationHours = Math.max(1, Math.min(24, parseInt(body?.durationHours || 1, 10)));
  if (!purchaseId || !startsAt) return res.status(400).json({ error: 'Missing purchaseId or startsAt' });
  const startMs = Date.parse(startsAt);
  if (Number.isNaN(startMs)) return res.status(400).json({ error: 'Invalid start time' });

  const svc = { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE, 'Content-Type': 'application/json' };

  try {
    const pr = await fetch(`${URL_}/rest/v1/pass_purchases?id=eq.${encodeURIComponent(purchaseId)}&select=*,listing_passes(*)`, { headers: svc });
    const purchase = (await pr.json())?.[0];
    if (!purchase) return res.status(404).json({ error: 'Pass not found' });
    if (purchase.driver_id !== driver.id) return res.status(403).json({ error: 'Not your pass' });
    if (purchase.credits_remaining < 1) return res.status(400).json({ error: 'No credits left on this pass' });
    const pass = purchase.listing_passes;
    const today = new Date().toISOString().slice(0, 10);
    if (pass?.valid_to && pass.valid_to < today) return res.status(400).json({ error: 'This pass has expired (unused credits aren’t refundable)' });

    const lr = await fetch(`${URL_}/rest/v1/rental_listings?id=eq.${pass.listing_id}&select=id,title,owner_id,status,spaces`, { headers: svc });
    const listing = (await lr.json())?.[0];
    if (!listing || listing.status !== 'active') return res.status(400).json({ error: 'Listing not bookable' });

    // Same overlap rule as paid checkout.
    const endsAtISO = new Date(startMs + durationHours * 3600000).toISOString();
    const spaces = Math.max(1, listing.spaces || 1);
    const or = await fetch(`${URL_}/rest/v1/bookings?listing_id=eq.${listing.id}&status=in.(pending,paid)&starts_at=lt.${encodeURIComponent(endsAtISO)}&ends_at=gt.${encodeURIComponent(startsAt)}&select=status,created_at`, { headers: svc });
    const overlaps = or.ok ? await or.json() : [];
    const now = Date.now();
    const held = overlaps.filter(b => b.status === 'paid' || (now - Date.parse(b.created_at) < 30 * 60000)).length;
    if (held >= spaces) return res.status(409).json({ error: 'That time is already booked.' });

    // Atomic decrement — fails (returns empty) if credits hit 0 concurrently.
    const rpc = await fetch(`${URL_}/rest/v1/rpc/redeem_pass_credit`, {
      method: 'POST', headers: svc, body: JSON.stringify({ p_purchase: purchase.id }),
    });
    const remaining = rpc.ok ? await rpc.json() : null;
    if (remaining === null || remaining === undefined || remaining === '' ) {
      return res.status(409).json({ error: 'Could not redeem a credit — try again' });
    }

    const cutoffHours = parseInt(process.env.CANCEL_CUTOFF_HOURS || '24', 10);
    const ins = await fetch(`${URL_}/rest/v1/bookings`, {
      method: 'POST', headers: { ...svc, Prefer: 'return=representation' },
      body: JSON.stringify({
        listing_id: listing.id, host_id: listing.owner_id,
        driver_id: driver.id, driver_email: driver.email || null,
        starts_at: startsAt, ends_at: endsAtISO, duration_hours: durationHours,
        cancellation_deadline: new Date(startMs - cutoffHours * 3600000).toISOString(),
        currency: 'gbp', amount_total_pence: 0, booking_price_pence: 0,
        application_fee_pence: 0, service_fee_pence: 0,
        pass_purchase_id: purchase.id, status: 'paid',
      }),
    });
    if (!ins.ok) return res.status(502).json({ error: 'Could not create the booking' });
    const bookingRow = (await ins.json())?.[0];

    return res.status(200).json({ ok: true, creditsRemaining: remaining, bookingId: bookingRow?.id });
  } catch (e) {
    console.error('passes/redeem', e);
    return res.status(500).json({ error: e.message || 'Redemption failed' });
  }
}
