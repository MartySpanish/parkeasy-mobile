// POST /api/listings/claim — attach listings we created on a host's behalf to
// their account, the first time they sign in.
//
// Why this exists. Organization listings are built by ParkEasy from a signed
// agreement, not typed in by the host: Belfast Royal Academy's car park was
// created from Ciarán McAuley's licence agreement before he had an account at
// all. That leaves the listing with an owner_email and no owner_id — and
// owner_id is what every downstream thing keys on:
//
//   * /api/checkout/create-session looks up host_accounts by listing.owner_id
//     to find where to send the money. No owner_id, no payout, 409 at checkout.
//   * The Spaces tab lists listings by owner_id, so the host can't see their
//     own space, and the "Set up payouts" card never appears.
//
// So without this, we email a host a link to set up payouts and they arrive at
// a screen with nothing on it.
//
// The check that matters: we only ever claim a listing whose owner_email
// matches the CONFIRMED email on the account. An unconfirmed address is just a
// string somebody typed, and honouring it would let anyone sign up as
// cmcauley301@bfsra.belfast.ni.sch.uk and take over the Academy's car park and
// its payouts.

const ALLOWED_ORIGINS = /^https:\/\/(www\.)?parkeasy\.uk$|\.vercel\.app$/;
function applyCors(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
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
  if (!URL_ || !ANON || !SERVICE) return res.status(500).json({ error: 'Supabase not configured' });

  const jwt = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return res.status(401).json({ error: 'Sign in first' });

  let caller;
  try {
    const u = await fetch(`${URL_}/auth/v1/user`, { headers: { Authorization: `Bearer ${jwt}`, apikey: ANON } });
    if (!u.ok) return res.status(401).json({ error: 'Invalid session' });
    caller = await u.json();
  } catch { return res.status(401).json({ error: 'Auth check failed' }); }

  const email = String(caller?.email || '').trim().toLowerCase();
  const confirmed = !!(caller?.email_confirmed_at || caller?.confirmed_at);
  // Nothing to claim, and — importantly — nothing claimable on an address the
  // account holder has not proved they can read.
  if (!email || !confirmed) return res.status(200).json({ claimed: [] });

  const svc = { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE, 'Content-Type': 'application/json' };

  try {
    // owner_email is matched case-insensitively; owner_id must still be null,
    // so this can never move a listing off an account that already holds it.
    const q = `${URL_}/rest/v1/rental_listings`
      + `?owner_email=ilike.${encodeURIComponent(email)}`
      + `&owner_id=is.null&select=id,title`;
    const r = await fetch(q, { headers: svc });
    if (!r.ok) return res.status(502).json({ error: 'Lookup failed' });
    const rows = await r.json();
    if (!rows.length) return res.status(200).json({ claimed: [] });

    const ids = rows.map(l => l.id);
    const up = await fetch(
      `${URL_}/rest/v1/rental_listings?id=in.(${ids.map(encodeURIComponent).join(',')})&owner_id=is.null`,
      { method: 'PATCH', headers: { ...svc, Prefer: 'return=representation' },
        body: JSON.stringify({ owner_id: caller.id }) });
    if (!up.ok) {
      console.error('listings/claim patch failed', up.status, await up.text().catch(() => ''));
      return res.status(502).json({ error: 'Could not link your listing' });
    }
    const claimed = (await up.json()).map(l => ({ id: l.id, title: l.title }));
    return res.status(200).json({ claimed });
  } catch (e) {
    console.error('listings/claim', e);
    return res.status(500).json({ error: 'Claim failed' });
  }
}
