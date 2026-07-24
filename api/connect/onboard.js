// POST /api/connect/onboard — start (or resume) Stripe Connect onboarding for
// the logged-in host. Creates an Express connected account (transfers only,
// GB, weekly payouts) if the host doesn't have one, then returns a hosted
// Account Link URL for them to complete identity/bank details on Stripe.
//
// TEST MODE ONLY: this refuses to run unless STRIPE_SECRET_KEY is a test key.
// Live payouts are blocked until public-liability insurance is in place.
import Stripe from 'stripe';

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

  const KEY = process.env.STRIPE_SECRET_KEY;
  const URL_ = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const ANON = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  // Where Stripe sends the host back to. These hit the API host (Vercel), which
  // then redirects into the app — the app itself is on parkeasy.uk (GH Pages).
  const API_BASE = process.env.API_BASE || 'https://parkeasy-gray.vercel.app';

  if (!KEY) return res.status(500).json({ error: 'Stripe not configured (STRIPE_SECRET_KEY)' });
  // Live keys are refused unless STRIPE_LIVE_ENABLED=true is explicitly set —
  // going live is a deliberate switch, never an accident.
  if (!KEY.startsWith('sk_test_') && process.env.STRIPE_LIVE_ENABLED !== 'true') {
    return res.status(403).json({ error: 'Live Stripe key detected but STRIPE_LIVE_ENABLED is not set. Refusing to run.' });
  }
  if (!URL_ || !ANON || !SERVICE) return res.status(500).json({ error: 'Supabase not configured (SUPABASE_SERVICE_ROLE_KEY required)' });

  const jwt = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return res.status(401).json({ error: 'Sign in to set up payouts' });
  let caller;
  try {
    const u = await fetch(`${URL_}/auth/v1/user`, { headers: { Authorization: `Bearer ${jwt}`, apikey: ANON } });
    if (!u.ok) return res.status(401).json({ error: 'Invalid session' });
    caller = await u.json();
  } catch { return res.status(401).json({ error: 'Auth check failed' }); }

  const stripe = new Stripe(KEY, { httpClient: Stripe.createFetchHttpClient(), maxNetworkRetries: 2, timeout: 20000 });
  const svc = { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE, 'Content-Type': 'application/json' };

  try {
    const hr = await fetch(`${URL_}/rest/v1/host_accounts?host_id=eq.${caller.id}&select=*`, { headers: svc });
    const existing = (await hr.json())?.[0];
    let accountId = existing?.stripe_account_id || null;

    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        country: 'GB',
        email: caller.email,
        capabilities: { transfers: { requested: true } },   // payouts only — hosts never take card payments
        settings: { payouts: { schedule: { interval: 'weekly', weekly_anchor: 'monday' } } },
        metadata: { host_id: caller.id },
      });
      accountId = account.id;

      // Upsert on host_id so this is idempotent and never silently no-ops.
      const w = await fetch(`${URL_}/rest/v1/host_accounts?on_conflict=host_id`, {
        method: 'POST', headers: { ...svc, Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({ host_id: caller.id, stripe_account_id: accountId, onboarding_status: 'onboarding', updated_at: new Date().toISOString() }),
      });
      if (!w.ok) console.error('connect/onboard host_accounts upsert failed', w.status, await w.text().catch(() => ''));
    }

    const link = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${API_BASE}/api/connect/refresh?acct=${accountId}`,
      return_url: `${API_BASE}/api/connect/return?acct=${accountId}`,
      type: 'account_onboarding',
    });

    return res.status(200).json({ url: link.url });
  } catch (e) {
    console.error('connect/onboard', e);
    return res.status(500).json({ error: e.message || 'Onboarding failed' });
  }
}
