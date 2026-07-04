// Master-account analytics endpoint.
//
// Security model: the caller must be logged in via Supabase; we verify their
// JWT server-side and only proceed when their email is on the admin list.
// User counts come from the Supabase Admin API using the SERVICE ROLE key,
// which lives only in Vercel env vars — never in the client bundle.
//
// Required Vercel env:
//   SUPABASE_SERVICE_ROLE_KEY  – Supabase → Settings → API → service_role
// Optional:
//   ADMIN_EMAILS               – comma-separated master emails
//   (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are reused from the app.)

const DEFAULT_ADMINS = 'martinrooney3@hotmail.com,parkeasyuk@gmail.com';


// CORS: the static site on parkeasy.uk (GitHub Pages) calls these functions
// cross-origin on the Vercel deployment.
const ALLOWED_ORIGINS = /^https:\/\/(www\.)?parkeasy\.uk$|\.vercel\.app$/;
function applyCors(req, res) {
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.test(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  return false;
}
export default async function handler(req, res) {
  if (applyCors(req, res)) return;
  const URL_ = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const ANON = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ADMINS = (process.env.ADMIN_EMAILS || DEFAULT_ADMINS).toLowerCase().split(',').map(s => s.trim()).filter(Boolean);

  if (!URL_ || !ANON) return res.status(500).json({ error: 'Supabase not configured' });

  // 1) Verify the caller's own session token
  const jwt = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return res.status(401).json({ error: 'Not signed in' });
  let caller;
  try {
    const u = await fetch(`${URL_}/auth/v1/user`, { headers: { Authorization: `Bearer ${jwt}`, apikey: ANON } });
    if (!u.ok) return res.status(401).json({ error: 'Invalid session' });
    caller = await u.json();
  } catch { return res.status(401).json({ error: 'Auth check failed' }); }
  if (!ADMINS.includes((caller.email || '').toLowerCase())) {
    return res.status(403).json({ error: 'Not an admin account' });
  }

  if (!SERVICE) {
    return res.status(200).json({ ok: true, configured: false,
      hint: 'Add SUPABASE_SERVICE_ROLE_KEY to Vercel env to unlock user analytics.' });
  }

  // 2) Pull analytics with the service key (server-side only)
  const svc = { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE };
  try {
    // Users (paginate up to 20 pages × 200 = 4k users; fine for now)
    const users = [];
    for (let page = 1; page <= 20; page++) {
      const r = await fetch(`${URL_}/auth/v1/admin/users?page=${page}&per_page=200`, { headers: svc });
      if (!r.ok) break;
      const d = await r.json();
      const batch = d.users || d || [];
      users.push(...batch);
      if (batch.length < 200) break;
    }
    const now = Date.now(), DAY = 86400000;
    const within = (u, days) => now - new Date(u.created_at).getTime() < days * DAY;
    const latest = [...users]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 12)
      .map(u => ({ email: u.email, name: u.user_metadata?.name || '', created: u.created_at, lastSeen: u.last_sign_in_at }));

    // Rental listings
    let listings = { total: 0, latest: [] };
    try {
      const lr = await fetch(`${URL_}/rest/v1/rental_listings?select=id,title,address,created_at,status&order=created_at.desc&limit=100`,
        { headers: { ...svc, Prefer: 'count=exact' } });
      if (lr.ok) {
        const rows = await lr.json();
        const range = lr.headers.get('content-range');
        listings.total = range?.includes('/') ? parseInt(range.split('/')[1]) || rows.length : rows.length;
        listings.latest = rows.slice(0, 6);
      }
    } catch { /* table may not exist yet */ }

    return res.status(200).json({
      ok: true, configured: true,
      users: {
        total: users.length,
        last7: users.filter(u => within(u, 7)).length,
        last30: users.filter(u => within(u, 30)).length,
        activeLast7: users.filter(u => u.last_sign_in_at && (now - new Date(u.last_sign_in_at).getTime() < 7 * DAY)).length,
        latest,
      },
      listings,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message || 'Analytics fetch failed' });
  }
}
