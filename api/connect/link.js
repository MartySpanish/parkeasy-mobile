// GET /api/connect/link?mode=return|refresh&acct=acct_xxx — merged Account
// Link return/refresh targets (one serverless function instead of two; the
// Hobby plan caps deployments at 12 functions). The old /api/connect/return
// and /api/connect/refresh URLs keep working via vercel.json rewrites.
import Stripe from 'stripe';

export default async function handler(req, res) {
  const KEY = process.env.STRIPE_SECRET_KEY;
  const URL_ = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const API_BASE = process.env.API_BASE || 'https://parkeasy-gray.vercel.app';
  const APP_URL = process.env.APP_URL || 'https://parkeasy.uk';
  const acct = String(req.query.acct || '');
  const mode = String(req.query.mode || 'return');

  const keyOk = KEY && (KEY.startsWith('sk_test_') || process.env.STRIPE_LIVE_ENABLED === 'true');
  if (!keyOk || !acct) return res.redirect(302, `${APP_URL}/?payouts=error`);
  const stripe = new Stripe(KEY, { httpClient: Stripe.createFetchHttpClient(), maxNetworkRetries: 2, timeout: 20000 });

  if (mode === 'refresh') {
    // Expired/reloaded onboarding link → mint a fresh one and continue.
    try {
      const link = await stripe.accountLinks.create({
        account: acct,
        refresh_url: `${API_BASE}/api/connect/link?mode=refresh&acct=${acct}`,
        return_url: `${API_BASE}/api/connect/link?mode=return&acct=${acct}`,
        type: 'account_onboarding',
      });
      return res.redirect(302, link.url);
    } catch (e) {
      console.error('connect/link refresh', e);
      return res.redirect(302, `${APP_URL}/?payouts=error`);
    }
  }

  // mode=return: re-fetch the account (Stripe is the source of truth), upsert
  // host_accounts (self-healing via metadata.host_id), send the host back.
  if (!URL_ || !SERVICE) return res.redirect(302, `${APP_URL}/?payouts=error`);
  try {
    const account = await stripe.accounts.retrieve(acct);
    const transfersActive = account.capabilities?.transfers === 'active';
    const status = transfersActive && account.payouts_enabled
      ? 'active'
      : account.requirements?.disabled_reason
        ? 'restricted'
        : 'onboarding';
    const hostId = account.metadata?.host_id || null;
    const svc = { Authorization: `Bearer ${SERVICE}`, apikey: SERVICE, 'Content-Type': 'application/json' };
    if (hostId) {
      const r = await fetch(`${URL_}/rest/v1/host_accounts?on_conflict=host_id`, {
        method: 'POST', headers: { ...svc, Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify({ host_id: hostId, stripe_account_id: acct, onboarding_status: status, transfers_active: transfersActive, updated_at: new Date().toISOString() }),
      });
      if (!r.ok) console.error('connect/link upsert failed', r.status, await r.text().catch(() => ''));
    } else {
      await fetch(`${URL_}/rest/v1/host_accounts?stripe_account_id=eq.${acct}`, {
        method: 'PATCH', headers: svc,
        body: JSON.stringify({ onboarding_status: status, transfers_active: transfersActive, updated_at: new Date().toISOString() }),
      });
    }
    return res.redirect(302, `${APP_URL}/?payouts=${status === 'active' ? 'done' : 'pending'}`);
  } catch (e) {
    console.error('connect/link return', e);
    return res.redirect(302, `${APP_URL}/?payouts=error`);
  }
}
