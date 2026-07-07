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

  // Config health (booleans / masked values only — never leak secrets). Lets the
  // dashboard show exactly which env vars are missing and why email/analytics
  // aren't working.
  const env = {
    contactEmail: !!process.env.CONTACT_EMAIL,
    contactEmailMasked: process.env.CONTACT_EMAIL
      ? process.env.CONTACT_EMAIL.replace(/^(.).*(@.*)$/, '$1•••$2') : null,
    resendKey: !!process.env.RESEND_API_KEY,
    emailFrom: process.env.EMAIL_FROM || 'onboarding@resend.dev (Resend test sender)',
    emailFromCustom: !!process.env.EMAIL_FROM,
    serviceKey: !!SERVICE,
  };

  // ── Live test email: sends to CONTACT_EMAIL and returns the REAL Resend
  // result, so the admin sees the actual delivery error (test-mode restriction,
  // unverified domain, bad key, …) instead of the app's silent failure. ──
  if (req.method === 'POST') {
    let peek = req.body;
    if (typeof peek === 'string') { try { peek = JSON.parse(peek); } catch { peek = {}; } }
    if (peek?.action === 'test-email') {
      const TO = process.env.CONTACT_EMAIL;
      const KEY = process.env.RESEND_API_KEY;
      const FROM = process.env.EMAIL_FROM || 'ParkEasy <onboarding@resend.dev>';
      if (!TO) return res.status(200).json({ ok: false, stage: 'config', error: 'CONTACT_EMAIL is not set in Vercel — the app has nowhere to send notifications.' });
      if (!KEY) return res.status(200).json({ ok: false, stage: 'config', error: 'RESEND_API_KEY is not set in Vercel — the app cannot send any email.' });
      try {
        const r = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: FROM, to: [TO],
            subject: '✅ ParkEasy test email — notifications are working',
            html: `<p>This diagnostic email was sent from your ParkEasy admin dashboard.</p><p>If you can read this, signup and listing notifications will arrive at <strong>${TO}</strong>.</p>`,
          }),
        });
        const detail = await r.text().catch(() => '');
        if (!r.ok) return res.status(200).json({ ok: false, stage: 'resend', httpStatus: r.status, error: detail || 'Resend rejected the request.', to: env.contactEmailMasked, from: FROM });
        return res.status(200).json({ ok: true, to: env.contactEmailMasked, from: FROM });
      } catch (e) {
        return res.status(200).json({ ok: false, stage: 'network', error: e.message || 'send failed' });
      }
    }
  }

  if (!SERVICE) {
    return res.status(200).json({ ok: true, configured: false, env,
      hint: 'Add SUPABASE_SERVICE_ROLE_KEY to Vercel env to unlock user analytics.' });
  }

  const svcH = { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE, 'Content-Type': 'application/json' };

  // ── Founder actions: approve / reject organization listings ──
  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
    const { action, id, reason } = body || {};
    if (!id || !['approve', 'reject'].includes(action)) return res.status(400).json({ error: 'Bad request' });
    if (action === 'reject' && !(reason || '').trim()) return res.status(400).json({ error: 'Rejection requires a reason' });

    const lr = await fetch(`${URL_}/rest/v1/rental_listings?id=eq.${encodeURIComponent(id)}&select=*`, { headers: svcH });
    const listing = (await lr.json())?.[0];
    if (!listing) return res.status(404).json({ error: 'Listing not found' });

    const patch = action === 'approve'
      ? { approved_by_founder: true, status: 'active', published_at: new Date().toISOString(), rejection_reason: null }
      : { status: 'rejected', rejection_reason: reason.trim() };
    const up = await fetch(`${URL_}/rest/v1/rental_listings?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH', headers: svcH, body: JSON.stringify(patch),
    });
    if (!up.ok) return res.status(502).json({ error: 'Update failed', detail: await up.text().catch(() => '') });

    // Tell the host by email (approval or rejection with reason)
    const hostEmail = listing.contact_email || listing.owner_email;
    if (hostEmail && process.env.RESEND_API_KEY) {
      const subj = action === 'approve'
        ? `✅ Your ParkEasy listing is live: ${listing.title}`
        : `Your ParkEasy listing needs changes: ${listing.title}`;
      const html = action === 'approve'
        ? `<p>Good news — your listing <strong>${listing.title}</strong> has been approved and is now live on ParkEasy.</p>`
        : `<p>Thanks for submitting <strong>${listing.title}</strong>. We can't publish it yet:</p><blockquote>${(reason || '').replace(/</g, '&lt;')}</blockquote><p>Update the listing in the ParkEasy app and resubmit — we review within 24 hours.</p>`;
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: process.env.EMAIL_FROM || 'ParkEasy <onboarding@resend.dev>', to: [hostEmail], subject: subj, html }),
      }).catch(() => {});
    }
    return res.status(200).json({ ok: true });
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

    // Organization listings awaiting founder approval
    let pending = [];
    try {
      const pr = await fetch(`${URL_}/rest/v1/rental_listings?status=eq.pending_approval&select=*&order=created_at.asc`, { headers: svcH });
      if (pr.ok) pending = await pr.json();
    } catch { /* ignore */ }

    // Promo-code redemptions (e.g. PARKEZ) — total count + most recent.
    let promos = { total: 0, latest: [] };
    try {
      const rr = await fetch(`${URL_}/rest/v1/promo_redemptions?select=user_email,code,redeemed_at,expires_at&order=redeemed_at.desc&limit=50`,
        { headers: { ...svc, Prefer: 'count=exact' } });
      if (rr.ok) {
        const rows = await rr.json();
        const range = rr.headers.get('content-range');
        promos.total = range?.includes('/') ? parseInt(range.split('/')[1]) || rows.length : rows.length;
        promos.latest = rows.slice(0, 8);
      }
    } catch { /* table may not exist yet */ }

    return res.status(200).json({
      ok: true, configured: true,
      env,
      pending,
      promos,
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
