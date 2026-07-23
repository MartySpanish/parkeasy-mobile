// Promo-code redemption (e.g. PARKEZ → 7 days Premium).
//
// The redemption WINDOW and code are CONFIGURABLE via env vars — nothing is
// hardcoded, so you can open/close the promo without a redeploy of code:
//   PROMO_CODE   – the code to accept (default "PARKEZ"), matched case-insensitively
//   PROMO_START  – ISO timestamp when redemption opens  (e.g. 2026-07-08T09:00:00Z)
//   PROMO_END    – ISO timestamp when redemption closes (e.g. 2026-07-09T09:00:00Z)
//   PROMO_DAYS   – days of Premium granted (default 7)
//
// Turn the promo OFF by clearing PROMO_START / PROMO_END (or setting PROMO_END in
// the past). With no valid window set, redemption is refused.
//
// Enforcement lives HERE (server-side, service-role) plus a UNIQUE (user_id, code)
// DB constraint — the client entitlement is applied from what this returns.

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
  if (!URL_ || !ANON || !SERVICE) return res.status(500).json({ error: 'Backend not configured' });

  // Verify the caller's own session
  const jwt = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return res.status(401).json({ error: 'Sign in to redeem a promo code' });
  let caller;
  try {
    const u = await fetch(`${URL_}/auth/v1/user`, { headers: { Authorization: `Bearer ${jwt}`, apikey: ANON } });
    if (!u.ok) return res.status(401).json({ error: 'Invalid session' });
    caller = await u.json();
  } catch { return res.status(401).json({ error: 'Auth check failed' }); }

  const svc = { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE, 'Content-Type': 'application/json' };
  const CODE = (process.env.PROMO_CODE || 'PARKEZ').trim().toUpperCase();
  const DAYS = Number(process.env.PROMO_DAYS || 7) || 7;

  // GET → the caller's active entitlement, used to sync Premium on login /
  // across devices (returns null once it has expired).
  if (req.method === 'GET') {
    try {
      const r = await fetch(`${URL_}/rest/v1/promo_redemptions?user_id=eq.${caller.id}&order=expires_at.desc&limit=1&select=expires_at`, { headers: svc });
      const row = (await r.json())?.[0];
      const until = row ? Date.parse(row.expires_at) : 0;
      return res.status(200).json({ ok: true, premiumUntil: until > Date.now() ? until : null });
    } catch { return res.status(200).json({ ok: true, premiumUntil: null }); }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const entered = String(body?.code || '').trim().toUpperCase();   // case-insensitive
  if (!entered) return res.status(400).json({ error: 'Enter a promo code.' });
  if (entered !== CODE) return res.status(400).json({ error: 'That promo code isn’t valid.' });

  // Window check — configurable, never hardcoded.
  const start = Date.parse(process.env.PROMO_START || '');
  const end   = Date.parse(process.env.PROMO_END || '');
  const now   = Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return res.status(403).json({ error: 'This promo isn’t running right now.' });
  }
  if (now < start) return res.status(403).json({ error: 'This promo hasn’t started yet.' });
  if (now > end)   return res.status(403).json({ error: 'This promo has ended.' });

  // Already redeemed by this account?
  try {
    const existing = await fetch(`${URL_}/rest/v1/promo_redemptions?user_id=eq.${caller.id}&code=eq.${encodeURIComponent(CODE)}&select=id`, { headers: svc });
    if ((await existing.json())?.length) return res.status(409).json({ error: 'You’ve already redeemed this code.' });
  } catch { /* fall through — the UNIQUE constraint is the real guard */ }

  const expiresAtIso = new Date(now + DAYS * 86400000).toISOString();
  const ins = await fetch(`${URL_}/rest/v1/promo_redemptions`, {
    method: 'POST',
    headers: { ...svc, Prefer: 'return=representation' },
    body: JSON.stringify({ user_id: caller.id, user_email: caller.email, code: CODE, expires_at: expiresAtIso }),
  });
  // 409 = UNIQUE (user_id, code) violation → a concurrent/repeat redemption.
  if (ins.status === 409) return res.status(409).json({ error: 'You’ve already redeemed this code.' });
  if (!ins.ok) return res.status(502).json({ error: 'Could not redeem right now — please try again.', detail: await ins.text().catch(() => '') });

  return res.status(200).json({ ok: true, premiumUntil: Date.parse(expiresAtIso), days: DAYS });
}
